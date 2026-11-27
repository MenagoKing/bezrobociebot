import { RetryableError, errorMessage } from '../core/util.ts';

export interface ParsedTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmountString?: string; uiAmount: number | null };
}

export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: ParsedTokenBalance[];
    postTokenBalances?: ParsedTokenBalance[];
  } | null;
  transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } };
}

/** Minimalny klient JSON-RPC Solany (fetch, timeouty, rozróżnienie błędów ponawialnych). */
export class SolanaRpc {
  private getUrl: () => string;
  private id = 0;

  constructor(getUrl: () => string) {
    this.getUrl = getUrl;
  }

  async call<T>(method: string, params: unknown[], timeoutMs = 15_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.getUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new RetryableError(`RPC ${method}: ${errorMessage(err)}`);
    }
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`RPC ${method}: HTTP ${res.status}`);
    if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
    return body.result as T;
  }

  async getBalanceLamports(address: string): Promise<number> {
    const r = await this.call<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
    return r.value;
  }

  /** Suma sald tokena (wszystkie konta danego właściciela dla danego minta). */
  async getTokenBalance(owner: string, mint: string): Promise<{ raw: bigint; ui: number; decimals: number }> {
    const r = await this.call<{
      value: { account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number; uiAmountString: string } } } } } }[];
    }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    let raw = 0n;
    let decimals = 0;
    for (const acc of r.value) {
      const amt = acc.account.data.parsed.info.tokenAmount;
      raw += BigInt(amt.amount);
      decimals = amt.decimals;
    }
    return { raw, ui: Number(raw) / 10 ** decimals, decimals };
  }

  async sendTransaction(base64Tx: string): Promise<string> {
    return this.call<string>('sendTransaction', [
      base64Tx,
      { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 },
    ]);
  }

  async getSignatureStatus(signature: string): Promise<{ confirmationStatus: string | null; err: unknown } | null> {
    const r = await this.call<{ value: ({ confirmationStatus: string | null; err: unknown } | null)[] }>(
      'getSignatureStatuses',
      [[signature], { searchTransactionHistory: true }],
    );
    return r.value[0] ?? null;
  }

  async getBlockHeight(): Promise<number> {
    return this.call<number>('getBlockHeight', [{ commitment: 'confirmed' }]);
  }

  async getTransaction(signature: string): Promise<ParsedTransaction | null> {
    return this.call<ParsedTransaction | null>('getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ]);
  }
}
