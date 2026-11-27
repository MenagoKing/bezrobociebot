import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Candle, MarketSnapshot, TokenInfo } from '../../shared/types.ts';
import { RetryableError } from '../src/core/util.ts';
import { ChartCandles, aggregate, candlesFromTicks } from '../src/market/chartCandles.ts';
import type { LiveMarketProvider } from '../src/market/liveProvider.ts';

const ADDR = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const token = { address: ADDR, chain: 'solana', pairAddress: 'pair' } as TokenInfo;
const bar = (time: number, close: number): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10 });

function make(fetchCandles: (tf: number) => Promise<Candle[] | null>) {
  const calls: number[] = [];
  const live = {
    fetchCandles: (_t: TokenInfo, tf: number) => {
      calls.push(tf);
      return fetchCandles(tf);
    },
    fetchSnapshot: async () => ({ ts: Date.now(), priceUsd: 2, volume5mUsd: 300 }) as MarketSnapshot,
  } as unknown as LiveMarketProvider;
  const chart = new ChartCandles(live, {
    sessionToken: () => null,
    sessionSnapshot: () => null,
    sessionTicks: () => [],
    sessionSeries: () => ({ tf: 60, bars: [] }),
    resolve: async () => token,
  });
  return { chart, calls };
}

test('świece z ticków: jedna świeca na kubełek, open = poprzednie zamknięcie', () => {
  const c = candlesFromTicks(
    [
      { ts: 10_000, price: 1, vol: 1 },
      { ts: 12_000, price: 3, vol: 1 },
      { ts: 16_000, price: 2, vol: 1 },
    ],
    5,
  );
  assert.equal(c.length, 2);
  assert.deepEqual([c[0]!.open, c[0]!.high, c[0]!.close, c[0]!.volume], [1, 3, 3, 2]);
  assert.equal(c[1]!.open, 3);
});

test('agregacja 1 h → 4 h zachowuje high/low/close i sumuje wolumen', () => {
  const hours = [0, 1, 2, 3, 4].map((h) => bar(h * 3600, 10 + h));
  const four = aggregate(hours, 14400);
  assert.equal(four.length, 2);
  assert.equal(four[0]!.close, 13);
  assert.equal(four[0]!.high, 14);
  assert.equal(four[0]!.volume, 40);
});

test('wykres: cache i łączenie zapytań — równoległe prośby to jedno zapytanie do API', async () => {
  const { chart, calls } = make(async () => [bar(0, 1), bar(3600, 2)]);
  const [a, b] = await Promise.all([chart.get(ADDR, 3600), chart.get(ADDR, 3600)]);
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  await chart.get(ADDR, 3600);
  assert.deepEqual(calls, [3600]);
});

test('wykres: przy limicie API grubszy interwał składa się z drobniejszego z cache', async () => {
  let limited = false;
  const { chart } = make(async (tf) => {
    if (limited) throw new RetryableError('HTTP 429 z api.geckoterminal.com');
    return tf === 3600 ? [0, 1, 2, 3, 4, 5, 6, 7].map((h) => bar(h * 3600, h)) : null;
  });
  await chart.get(ADDR, 3600);
  limited = true;
  const four = await chart.get(ADDR, 14400);
  assert.equal(four.length, 2);
  assert.equal(four[1]!.close, 7);
});

test('wykres: interwał sekundowy działa też bez sesji (własny podgląd ceny)', async () => {
  const { chart } = make(async () => null);
  const c = await chart.get(ADDR, 1);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.close, 2);
  chart.close();
});
