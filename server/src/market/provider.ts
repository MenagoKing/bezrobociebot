import type { Candle, DataSource, MarketSnapshot, TokenInfo } from '../../../shared/types.ts';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const EVM_NATIVE = '0x0000000000000000000000000000000000000000';

export interface MarketProvider {
  readonly source: DataSource;
  /** chain: 'solana' albo klucz sieci EVM. */
  resolveToken(address: string, chain: string): Promise<TokenInfo>;
  fetchSnapshot(token: TokenInfo): Promise<MarketSnapshot>;
  /** Zwraca świece albo null, gdy źródło nie obsługuje danego interwału/puli. */
  fetchCandles(token: TokenInfo, timeframeSec: number, limit: number): Promise<Candle[] | null>;
  /** Kurs waluty natywnej sieci w USD (SOL, ETH, BNB…). */
  getNativeUsd(chain: string): Promise<number>;
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_IN_TEXT = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// 40 znaków hex — nie fragment dłuższego ciągu (np. 64-znakowego ID puli Uniswap v4)
const EVM_IN_TEXT = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

export function isValidSolanaAddress(address: string): boolean {
  return BASE58_ADDRESS.test(address);
}

export function isEvmAddress(address: string): boolean {
  return EVM_ADDRESS.test(address.trim());
}

/**
 * Wyciąga adres Solana z wklejonego tekstu: sam adres albo link
 * (np. pump.fun/coin/…, gmgn.ai/sol/token/…, dexscreener.com/solana/…). Zwraca null, gdy nic nie pasuje.
 */
export function extractSolanaAddress(input: string): string | null {
  const text = input.trim();
  if (isValidSolanaAddress(text)) return text;
  const candidates = text.match(BASE58_IN_TEXT) ?? [];
  return candidates.length ? candidates[candidates.length - 1]! : null;
}

export function extractEvmAddress(input: string): string | null {
  const candidates = input.trim().match(EVM_IN_TEXT) ?? [];
  return candidates.length ? candidates[candidates.length - 1]! : null;
}

/** Rozpoznaje rodzaj adresu tokena (EVM ma pierwszeństwo — format 0x jest jednoznaczny). */
export function parseTokenInput(input: string): { kind: 'evm' | 'solana'; address: string } | null {
  const evm = extractEvmAddress(input);
  if (evm) return { kind: 'evm', address: evm };
  const sol = extractSolanaAddress(input);
  return sol ? { kind: 'solana', address: sol } : null;
}
