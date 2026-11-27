import { fetchJson } from '../core/util.ts';

export interface LifiQuote {
  tool?: string;
  estimate: { toAmount: string; toAmountMin: string; approvalAddress: string };
  transactionRequest: { to: string; data: string; value?: string; gasLimit?: string; chainId: number; from?: string };
}

/** Wycena swapu w obrębie jednej sieci (LI.FI zwraca gotową transakcję do podpisu). */
export async function lifiQuote(
  baseUrl: string,
  apiKey: string | null,
  p: { chainId: number; fromToken: string; toToken: string; amount: bigint; from: string; slippage: number },
): Promise<LifiQuote> {
  const q = new URLSearchParams({
    fromChain: String(p.chainId),
    toChain: String(p.chainId),
    fromToken: p.fromToken,
    toToken: p.toToken,
    fromAmount: p.amount.toString(),
    fromAddress: p.from,
    slippage: String(p.slippage),
  });
  return fetchJson<LifiQuote>(`${baseUrl.replace(/\/$/, '')}/quote?${q}`, {
    headers: apiKey ? { 'x-lifi-api-key': apiKey } : {},
    timeoutMs: 20_000,
  });
}

/**
 * Kontrola wyceny przed podpisem: właściwa sieć i nadawca, dokładnie zamierzona kwota waluty natywnej,
 * kontrakt docelowy (i ewentualny approve) z allowlisty, niezerowa minimalna ilość na wyjściu.
 */
export function checkQuote(
  q: LifiQuote,
  o: { chainId: number; from: string; expectValue: bigint; allowlist: string[]; needsApproval: boolean },
): void {
  const tx = q.transactionRequest;
  const lc = (v: string) => v.toLowerCase();
  if (!tx?.to || !tx.data) throw new Error('Wycena bez transakcji do podpisu');
  if (Number(tx.chainId) !== o.chainId) throw new Error(`Transakcja dla innej sieci (${tx.chainId} ≠ ${o.chainId})`);
  if (tx.from && lc(tx.from) !== lc(o.from)) throw new Error('Transakcja przygotowana dla innego portfela');
  if (BigInt(tx.value ?? '0') !== o.expectValue) throw new Error('Kwota transakcji różni się od zamierzonej — odrzucono');
  const allow = o.allowlist.map(lc);
  if (allow.length && !allow.includes(lc(tx.to))) throw new Error(`Kontrakt ${tx.to} spoza allowlisty sieci — odrzucono`);
  if (o.needsApproval) {
    const spender = q.estimate.approvalAddress;
    if (!spender) throw new Error('Brak adresu do zatwierdzenia tokena');
    if (lc(spender) !== lc(tx.to) && !(allow.length && allow.includes(lc(spender)))) {
      throw new Error(`Approve dla ${spender} spoza allowlisty — odrzucono`);
    }
  }
  if (!(BigInt(q.estimate.toAmountMin ?? '0') > 0n)) throw new Error('Wycena z zerową minimalną ilością — odrzucono');
}
