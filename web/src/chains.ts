import { SOLANA, type AppSettings } from '../../shared/types.ts';
import { getState, useStore } from './store.ts';

/** Symbol waluty natywnej bieżącej sesji (SOL / ETH / BNB). */
export function useNativeSymbol(): string {
  return useStore((s) => s.session?.nativeSymbol ?? 'SOL');
}

function evmChain(settings: AppSettings | null | undefined, chain: string) {
  return settings?.evm?.chains.find((c) => c.key === chain) ?? null;
}

export function chainName(chain: string | undefined, settings: AppSettings | null = getState().settings): string {
  if (!chain || chain === SOLANA) return 'Solana';
  return evmChain(settings, chain)?.name ?? chain;
}

export function txUrl(chain: string | undefined, hash: string, settings: AppSettings | null = getState().settings): string {
  if (!chain || chain === SOLANA) return `https://solscan.io/tx/${hash}`;
  const base = evmChain(settings, chain)?.explorerUrl;
  return base ? `${base.replace(/\/$/, '')}/tx/${hash}` : `https://blockscan.com/tx/${hash}`;
}

export function addressUrl(chain: string | undefined, address: string, kind: 'token' | 'address', settings: AppSettings | null = getState().settings): string {
  if (!chain || chain === SOLANA) return `https://solscan.io/${kind === 'token' ? 'token' : 'account'}/${address}`;
  const base = evmChain(settings, chain)?.explorerUrl ?? 'https://blockscan.com';
  return `${base.replace(/\/$/, '')}/${kind}/${address}`;
}

/** Linki zewnętrzne do tokena zależnie od sieci. */
export function tokenLinks(chain: string, address: string): [string, string][] {
  if (chain === SOLANA) {
    return [
      ['Pump.fun', `https://pump.fun/coin/${address}`],
      ['GMGN', `https://gmgn.ai/sol/token/${address}`],
      ['DexScreener', `https://dexscreener.com/solana/${address}`],
      ['Solscan', `https://solscan.io/token/${address}`],
    ];
  }
  return [
    ['DexScreener', `https://dexscreener.com/${chain}/${address}`],
    ['Eksplorator', addressUrl(chain, address, 'token')],
  ];
}
