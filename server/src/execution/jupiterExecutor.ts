import type { Order, Position } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import { RetryableError, fetchJson, sleep } from '../core/util.ts';
import { WSOL_MINT } from '../market/provider.ts';
import type { SolanaKeypair } from '../solana/keypair.ts';
import type { ParsedTransaction, SolanaRpc } from '../solana/rpc.ts';
import { signSerializedTransaction } from '../solana/transaction.ts';
import { UncertainExecutionError, type ExecContext, type ExecHooks, type Executor, type Fill } from './executor.ts';

interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

/**
 * Wykonanie rzeczywiste przez Jupiter Swap API: quote → swap (transakcja do podpisu) →
 * lokalny podpis → wysyłka przez RPC → potwierdzenie → odczyt faktycznych kwot z transakcji.
 * Klucz prywatny nie opuszcza procesu; podpisywane są wyłącznie transakcje, w których
 * płatnikiem i jedynym sygnatariuszem jest skonfigurowany portfel.
 */
export class JupiterExecutor implements Executor {
  readonly mode = 'live' as const;
  private rpc: SolanaRpc;
  private settings: SettingsService;
  private getKeypair: (walletId: number) => SolanaKeypair;

  constructor(rpc: SolanaRpc, settings: SettingsService, getKeypair: (walletId: number) => SolanaKeypair) {
    this.rpc = rpc;
    this.settings = settings;
    this.getKeypair = getKeypair;
  }

  private base(): string {
    return this.settings.get().system.jupiterBaseUrl.replace(/\/$/, '');
  }

  private async quote(inputMint: string, outputMint: string, amount: string): Promise<unknown> {
    const { slippageBps } = this.settings.get().trading;
    const q = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippageBps), restrictIntermediateTokens: 'true' });
    return fetchJson(`${this.base()}/quote?${q}`, { timeoutMs: 10_000 });
  }

  private async swapAndConfirm(quote: unknown, kp: SolanaKeypair, hooks: ExecHooks): Promise<string> {
    const { priorityFeeLamports } = this.settings.get().trading;
    const swap = await fetchJson<SwapResponse>(`${this.base()}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: kp.address,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityFeeLamports,
      }),
      timeoutMs: 15_000,
    });
    const { signed, signature } = signSerializedTransaction(swap.swapTransaction, kp);
    // podpis zapisujemy PRZED wysyłką — po awarii da się sprawdzić, czy transakcja trafiła do sieci
    hooks.onSubmitted(signature);
    try {
      await this.rpc.sendTransaction(signed);
    } catch (err) {
      // błąd sieci: transakcja mogła dotrzeć — rozstrzyga pętla potwierdzeń poniżej
      if (!(err instanceof RetryableError)) throw err;
    }

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await sleep(1500);
      const status = await this.rpc.getSignatureStatus(signature).catch(() => null);
      if (status?.err) throw new Error(`Transakcja odrzucona przez sieć: ${JSON.stringify(status.err)}`);
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return signature;
      const height = await this.rpc.getBlockHeight().catch(() => 0);
      if (!status && height > swap.lastValidBlockHeight) {
        // blockhash wygasł, transakcja nie może już trafić do bloku — bezpieczne ponowienie
        throw new RetryableError('Transakcja wygasła przed potwierdzeniem');
      }
    }
    throw new UncertainExecutionError(`Brak potwierdzenia transakcji ${signature} w 90 s — sprawdź ją w eksploratorze`);
  }

  private async loadTx(signature: string): Promise<ParsedTransaction> {
    for (let i = 0; i < 8; i++) {
      const tx = await this.rpc.getTransaction(signature).catch(() => null);
      if (tx?.meta) return tx;
      await sleep(1000);
    }
    throw new UncertainExecutionError(`Nie udało się odczytać transakcji ${signature}`);
  }

  /** Faktyczne kwoty z metadanych transakcji (zmiany sald portfela). */
  private parseFill(tx: ParsedTransaction, owner: string, mint: string, side: 'buy' | 'sell', signature: string): Fill {
    const meta = tx.meta!;
    if (meta.err) throw new Error(`Transakcja zakończona błędem: ${JSON.stringify(meta.err)}`);
    const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
    const ownerIdx = keys.indexOf(owner);
    if (ownerIdx < 0) throw new Error('Portfel nie występuje w transakcji');
    const solDelta = (meta.postBalances[ownerIdx]! - meta.preBalances[ownerIdx]!) / 1e9;
    const fee = meta.fee / 1e9;
    const mine = (list?: { mint: string; owner?: string; accountIndex: number; uiTokenAmount: { amount: string; decimals: number } }[]) =>
      (list ?? []).filter((b) => b.mint === mint && b.owner === owner);
    const pre = mine(meta.preTokenBalances);
    const post = mine(meta.postTokenBalances);
    const decimals = post[0]?.uiTokenAmount.decimals ?? pre[0]?.uiTokenAmount.decimals ?? 6;
    const sum = (l: typeof pre) => l.reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
    const tokenDelta = Number(sum(post) - sum(pre)) / 10 ** decimals;
    // rent: nowe konto tokena (było 0 lamportów przed transakcją)
    let rentSol = 0;
    for (const b of post) {
      if (!pre.some((p) => p.accountIndex === b.accountIndex) && meta.preBalances[b.accountIndex] === 0) {
        rentSol += meta.postBalances[b.accountIndex]! / 1e9;
      }
    }
    if (side === 'buy') {
      const amount = tokenDelta;
      if (!(amount > 0)) throw new Error('Transakcja kupna nie zwiększyła salda tokena');
      const valueSol = -solDelta - fee - rentSol;
      return { amount, decimals, valueSol, feeSol: 0, networkFeeSol: fee, rentSol, priceSol: valueSol / amount, marketPriceSol: valueSol / amount, txSignature: signature };
    }
    const amount = -tokenDelta;
    if (!(amount > 0)) throw new Error('Transakcja sprzedaży nie zmniejszyła salda tokena');
    const valueSol = solDelta + fee;
    return { amount, decimals, valueSol, feeSol: 0, networkFeeSol: fee, rentSol: 0, priceSol: valueSol / amount, marketPriceSol: valueSol / amount, txSignature: signature };
  }

  async buy(ctx: ExecContext, valueSol: number, hooks: ExecHooks): Promise<Fill> {
    const kp = this.getKeypair(ctx.walletId);
    const lamports = Math.floor(valueSol * 1e9);
    if (lamports <= 0) throw new Error('Kwota zakupu jest zbyt mała');
    const quote = await this.quote(WSOL_MINT, ctx.token.address, String(lamports));
    const signature = await this.swapAndConfirm(quote, kp, hooks);
    return this.parseFill(await this.loadTx(signature), kp.address, ctx.token.address, 'buy', signature);
  }

  async sell(ctx: ExecContext, position: Position, isLastPosition: boolean, hooks: ExecHooks): Promise<Fill> {
    const kp = this.getKeypair(ctx.walletId);
    const balance = await this.rpc.getTokenBalance(kp.address, ctx.token.address);
    if (balance.raw === 0n) throw new Error('Brak tokenów w portfelu do sprzedaży');
    let raw = BigInt(Math.floor(position.amount * 10 ** balance.decimals));
    if (isLastPosition || raw > balance.raw) raw = balance.raw; // ostatnia pozycja: sprzedaj całość (bez pyłu)
    const quote = await this.quote(ctx.token.address, WSOL_MINT, raw.toString());
    const signature = await this.swapAndConfirm(quote, kp, hooks);
    return this.parseFill(await this.loadTx(signature), kp.address, ctx.token.address, 'sell', signature);
  }

  async reconcile(ctx: ExecContext, order: Order): Promise<Fill | null> {
    if (!order.txSignature) return null;
    const status = await this.rpc.getSignatureStatus(order.txSignature);
    if (!status || status.err || !status.confirmationStatus) return null;
    const kp = this.getKeypair(ctx.walletId);
    return this.parseFill(await this.loadTx(order.txSignature), kp.address, ctx.token.address, order.side, order.txSignature);
  }
}
