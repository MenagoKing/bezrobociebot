import { encodeFunctionData, keccak256, type Hex, type PrivateKeyAccount, type TransactionReceipt } from 'viem';
import type { Order, Position } from '../../../shared/types.ts';
import type { ChainRegistry } from '../chains/chainRegistry.ts';
import type { SettingsService } from '../config/settingsService.ts';
import { ERC20_ABI, type EvmClients } from '../evm/evmClients.ts';
import { checkQuote, lifiQuote } from '../evm/lifi.ts';
import { EVM_NATIVE } from '../market/provider.ts';
import { UncertainExecutionError, type ExecContext, type ExecHooks, type Executor, type Fill } from './executor.ts';

/** Koszt gazu z potwierdzenia (dla sieci OP-stack doliczana jest opłata L1, jeśli RPC ją zwraca). */
export function receiptGasCost(r: TransactionReceipt): bigint {
  const l1 = (r as unknown as { l1Fee?: bigint | string | null }).l1Fee;
  return r.gasUsed * r.effectiveGasPrice + (l1 === undefined || l1 === null ? 0n : BigInt(l1));
}

/**
 * Faktyczne kwoty transakcji z różnic sald portfela (waluta natywna i token) przed i po bloku transakcji.
 * Uwzględnia podatki od transferu, zwroty i dokładny koszt gazu.
 */
export function computeEvmFill(p: {
  side: 'buy' | 'sell';
  nativeBefore: bigint;
  nativeAfter: bigint;
  tokenBefore: bigint;
  tokenAfter: bigint;
  gasCostWei: bigint;
  extraGasWei: bigint;
  decimals: number;
  txHash: string;
}): Fill {
  const toNative = (w: bigint) => Number(w) / 1e18;
  const scale = 10 ** p.decimals;
  const networkFeeSol = toNative(p.gasCostWei + p.extraGasWei);
  if (p.side === 'buy') {
    const raw = p.tokenAfter - p.tokenBefore;
    if (raw <= 0n) throw new Error('Transakcja kupna nie zwiększyła salda tokena');
    const valueSol = toNative(p.nativeBefore - p.nativeAfter - p.gasCostWei);
    const amount = Number(raw) / scale;
    return { amount, decimals: p.decimals, valueSol, feeSol: 0, networkFeeSol, rentSol: 0, priceSol: valueSol / amount, marketPriceSol: valueSol / amount, txSignature: p.txHash };
  }
  const raw = p.tokenBefore - p.tokenAfter;
  if (raw <= 0n) throw new Error('Transakcja sprzedaży nie zmniejszyła salda tokena');
  const valueSol = toNative(p.nativeAfter - p.nativeBefore + p.gasCostWei);
  const amount = Number(raw) / scale;
  return { amount, decimals: p.decimals, valueSol, feeSol: 0, networkFeeSol, rentSol: 0, priceSol: valueSol / amount, marketPriceSol: valueSol / amount, txSignature: p.txHash };
}

function isNetworkError(err: unknown): boolean {
  const hit = (x: unknown) => ['HttpRequestError', 'TimeoutError'].includes((x as { name?: string } | null)?.name ?? '');
  const e = err as { message?: string; walk?: (fn: (x: unknown) => boolean) => unknown } | null;
  if (hit(e)) return true;
  if (typeof e?.walk === 'function' && e.walk(hit)) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(e?.message ?? '');
}

type Balances = { native: bigint; token: bigint };

/**
 * Wykonanie na sieciach EVM: wycena LI.FI → kontrola (sieć, kwota, allowlista kontraktów) → lokalny podpis (viem)
 * → wysyłka → potwierdzenie → odczyt faktycznych kwot z sald. Sprzedaż zatwierdza (approve) dokładnie sprzedawaną
 * ilość tokena, nigdy nieograniczoną. Klucz prywatny nie opuszcza procesu.
 */
export class EvmExecutor implements Executor {
  readonly mode = 'live' as const;
  private decimalsCache = new Map<string, number>();
  private registry: ChainRegistry;
  private clients: EvmClients;
  private settings: SettingsService;
  private getAccount: (walletId: number) => PrivateKeyAccount;
  private lifiApiKey: () => string | null;

  constructor(deps: {
    registry: ChainRegistry;
    clients: EvmClients;
    settings: SettingsService;
    getAccount: (walletId: number) => PrivateKeyAccount;
    lifiApiKey: () => string | null;
  }) {
    this.registry = deps.registry;
    this.clients = deps.clients;
    this.settings = deps.settings;
    this.getAccount = deps.getAccount;
    this.lifiApiKey = deps.lifiApiKey;
  }

  private async decimals(chain: string, token: Hex): Promise<number> {
    const key = `${chain}:${token.toLowerCase()}`;
    const hit = this.decimalsCache.get(key);
    if (hit !== undefined) return hit;
    const d = Number(await this.clients.public(chain).readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }));
    this.decimalsCache.set(key, d);
    return d;
  }

  private async balances(chain: string, owner: Hex, token: Hex, blockNumber?: bigint): Promise<Balances> {
    const pub = this.clients.public(chain);
    const [native, tok] = await Promise.all([
      pub.getBalance({ address: owner, blockNumber }),
      pub.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner], blockNumber }),
    ]);
    return { native, token: tok as bigint };
  }

  private async sendTx(
    chain: string,
    account: PrivateKeyAccount,
    req: { to: Hex; data: Hex; value: bigint; gas?: bigint },
    onHash?: (hash: string) => void,
  ): Promise<TransactionReceipt> {
    const wallet = this.clients.wallet(chain, account);
    const pub = this.clients.public(chain);
    const prepared = await wallet.prepareTransactionRequest({
      account,
      chain: this.clients.chain(chain),
      to: req.to,
      data: req.data,
      value: req.value,
      gas: req.gas,
    });
    const serialized = await wallet.signTransaction(prepared as Parameters<typeof wallet.signTransaction>[0]);
    const hash = keccak256(serialized);
    onHash?.(hash); // hash zapisany PRZED wysyłką — po awarii da się uzgodnić stan
    try {
      await wallet.sendRawTransaction({ serializedTransaction: serialized });
    } catch (err) {
      if (!isNetworkError(err)) throw err; // błąd sieci: transakcja mogła dotrzeć — rozstrzyga potwierdzenie
    }
    let receipt: TransactionReceipt;
    try {
      receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1_000 });
    } catch {
      throw new UncertainExecutionError(`Brak potwierdzenia transakcji ${hash} w 90 s — sprawdź ją w eksploratorze`);
    }
    if (receipt.status !== 'success') throw new Error(`Transakcja ${hash} odrzucona przez sieć (revert)`);
    return receipt;
  }

  private async fillFromReceipt(
    chain: string,
    owner: Hex,
    token: Hex,
    receipt: TransactionReceipt,
    side: 'buy' | 'sell',
    extraGasWei: bigint,
    pre?: Balances,
  ): Promise<Fill> {
    const gasCostWei = receiptGasCost(receipt);
    const decimals = await this.decimals(chain, token);
    let before: Balances;
    let after: Balances;
    try {
      [before, after] = await Promise.all([
        this.balances(chain, owner, token, receipt.blockNumber - 1n),
        this.balances(chain, owner, token, receipt.blockNumber),
      ]);
    } catch (err) {
      // RPC bez stanu historycznego: porównanie z migawką sprzed wysyłki
      if (!pre) throw err;
      before = pre;
      after = await this.balances(chain, owner, token);
    }
    return computeEvmFill({
      side,
      nativeBefore: before.native,
      nativeAfter: after.native,
      tokenBefore: before.token,
      tokenAfter: after.token,
      gasCostWei,
      extraGasWei,
      decimals,
      txHash: receipt.transactionHash,
    });
  }

  private quoteParams(chain: string) {
    const cfg = this.registry.evm(chain);
    return { cfg, base: this.settings.get().evm.lifiBaseUrl, slippage: this.settings.get().trading.slippageBps / 10_000 };
  }

  async buy(ctx: ExecContext, valueSol: number, hooks: ExecHooks): Promise<Fill> {
    const chain = ctx.token.chain;
    const { cfg, base, slippage } = this.quoteParams(chain);
    const account = this.getAccount(ctx.walletId);
    const token = ctx.token.address as Hex;
    const wei = BigInt(Math.floor(valueSol * 1e18));
    if (wei <= 0n) throw new Error('Kwota zakupu jest zbyt mała');
    const quote = await lifiQuote(base, this.lifiApiKey(), { chainId: cfg.chainId, fromToken: EVM_NATIVE, toToken: token, amount: wei, from: account.address, slippage });
    checkQuote(quote, { chainId: cfg.chainId, from: account.address, expectValue: wei, allowlist: cfg.routerAllowlist, needsApproval: false });
    const pre = await this.balances(chain, account.address, token);
    const tx = quote.transactionRequest;
    const receipt = await this.sendTx(
      chain,
      account,
      { to: tx.to as Hex, data: tx.data as Hex, value: wei, gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined },
      hooks.onSubmitted,
    );
    return this.fillFromReceipt(chain, account.address, token, receipt, 'buy', 0n, pre);
  }

  async sell(ctx: ExecContext, position: Position, isLastPosition: boolean, hooks: ExecHooks): Promise<Fill> {
    const chain = ctx.token.chain;
    const { cfg, base, slippage } = this.quoteParams(chain);
    const account = this.getAccount(ctx.walletId);
    const token = ctx.token.address as Hex;
    const decimals = await this.decimals(chain, token);
    const start = await this.balances(chain, account.address, token);
    if (start.token === 0n) throw new Error('Brak tokenów w portfelu do sprzedaży');
    let raw = BigInt(Math.floor(position.amount * 10 ** decimals));
    if (isLastPosition || raw > start.token) raw = start.token; // ostatnia pozycja: całość (bez pyłu)

    const quote = await lifiQuote(base, this.lifiApiKey(), { chainId: cfg.chainId, fromToken: token, toToken: EVM_NATIVE, amount: raw, from: account.address, slippage });
    checkQuote(quote, { chainId: cfg.chainId, from: account.address, expectValue: 0n, allowlist: cfg.routerAllowlist, needsApproval: true });
    const spender = quote.estimate.approvalAddress as Hex;
    const pub = this.clients.public(chain);
    const allowance = (await pub.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, spender] })) as bigint;
    let extraGasWei = 0n;
    if (allowance < raw) {
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, raw] });
      extraGasWei = receiptGasCost(await this.sendTx(chain, account, { to: token, data, value: 0n }));
    }
    const pre = await this.balances(chain, account.address, token);
    const tx = quote.transactionRequest;
    const receipt = await this.sendTx(
      chain,
      account,
      { to: tx.to as Hex, data: tx.data as Hex, value: 0n, gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined },
      hooks.onSubmitted,
    );
    return this.fillFromReceipt(chain, account.address, token, receipt, 'sell', extraGasWei, pre);
  }

  async reconcile(ctx: ExecContext, order: Order): Promise<Fill | null> {
    if (!order.txSignature) return null;
    const chain = ctx.token.chain;
    const receipt = await this.clients
      .public(chain)
      .getTransactionReceipt({ hash: order.txSignature as Hex })
      .catch(() => null);
    if (!receipt || receipt.status !== 'success') return null;
    return this.fillFromReceipt(chain, this.getAccount(ctx.walletId).address, ctx.token.address as Hex, receipt, order.side, 0n);
  }
}
