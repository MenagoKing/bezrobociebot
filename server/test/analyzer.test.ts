import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Candle } from '../../shared/types.ts';
import { DEFAULT_SETTINGS } from '../src/config/schema.ts';
import { analyze } from '../src/market/analyzer.ts';

const cfg = DEFAULT_SETTINGS.analysis;

/** Deterministyczne świece: trend (%/świecę) + piła o amplitudzie ±noisePct, zadany wolumen. */
function series(n: number, driftPct: number, noisePct: number, volume: (i: number) => number = () => 100): Candle[] {
  let prev = 0.0001;
  return Array.from({ length: n }, (_, i) => {
    const close = 0.0001 * (1 + driftPct / 100) ** i * (1 + (noisePct / 100) * (i % 2 ? 1 : -1));
    const open = prev;
    prev = close;
    return { time: i * 60, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close, volume: volume(i) };
  });
}

test('silny trend wzrostowy → Aggressive Growth', () => {
  const a = analyze(series(30, 2, 0.1), cfg, 50_000);
  assert.equal(a.scenario, 'AGGRESSIVE_GROWTH');
  assert.equal(a.insufficientData, false);
});

test('umiarkowany wzrost przy niskiej zmienności → Moderate Growth', () => {
  assert.equal(analyze(series(30, 0.5, 0.1), cfg, 50_000).scenario, 'MODERATE_GROWTH');
});

test('wzrost z dużą zmiennością → Volatile Growth', () => {
  assert.equal(analyze(series(30, 0.8, 2), cfg, 50_000).scenario, 'VOLATILE_GROWTH');
});

test('spadek → Downtrend', () => {
  assert.equal(analyze(series(30, -0.8, 0.1), cfg, 50_000).scenario, 'DOWNTREND');
});

test('brak trendu, duże wahania → High Volatility', () => {
  assert.equal(analyze(series(30, 0, 3), cfg, 50_000).scenario, 'HIGH_VOLATILITY');
});

test('płasko, wąski zakres, rosnący wolumen → Base Building', () => {
  assert.equal(analyze(series(30, 0, 0.2, (i) => 50 + i * 10), cfg, 50_000).scenario, 'BASE_BUILDING');
});

test('płasko, malejący wolumen, niska zmienność → Stable Market', () => {
  assert.equal(analyze(series(30, 0, 0.2, (i) => 400 - i * 10), cfg, 50_000).scenario, 'STABLE_MARKET');
});

test('za mało świec → insufficientData', () => {
  const a = analyze(series(5, 1, 0.2), cfg, 50_000);
  assert.equal(a.insufficientData, true);
  assert.equal(a.confidence, 0);
});

import { extractSolanaAddress, isEvmAddress } from '../src/market/provider.ts';

test('adres tokena: sam mint, link pump.fun/GMGN/DexScreener, wykrywanie adresu EVM', () => {
  const mint = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmpump';
  assert.equal(extractSolanaAddress(`  ${mint} `), mint);
  assert.equal(extractSolanaAddress(`https://pump.fun/coin/${mint}`), mint);
  assert.equal(extractSolanaAddress(`https://gmgn.ai/sol/token/${mint}?ref=x`), mint);
  assert.equal(extractSolanaAddress('to nie jest adres'), null);
  assert.equal(isEvmAddress('0xce95E835b149024530F0667e9F2CF34dc5E31C11'), true);
  assert.equal(isEvmAddress(mint), false);
});
