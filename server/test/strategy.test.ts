import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MarketAnalysis, MarketSnapshot, Position } from '../../shared/types.ts';
import { DEFAULT_SETTINGS } from '../src/config/schema.ts';
import { StateMachine } from '../src/engine/stateMachine.ts';
import { evaluateEntry, evaluateExit } from '../src/engine/strategy.ts';

const cfg = DEFAULT_SETTINGS.trading;
const now = 1_000_000_000;

const analysis = (scenario: MarketAnalysis['scenario'], confidence = 0.8): MarketAnalysis => ({
  ts: now,
  scenario,
  confidence,
  insufficientData: false,
  sampleSize: 30,
  reasons: [],
  metrics: { trendSlopePct: 0, trendR2: 0, direction: 'flat', momentumPct: 0, accelerationPct: 0, volatilityPct: 0, amplitudePct: 0, volumeWindowUsd: 0, volumeRatio: 1, liquidityUsd: 50_000, drawdownPct: 0 },
});

const snapshot: MarketSnapshot = { ts: now, priceUsd: 0.0001, priceSol: 0.0001 / 150, solUsd: 150, liquidityUsd: 50_000, volume5mUsd: 100, volume1hUsd: 1000, volume24hUsd: 10_000, buys5m: 5, sells5m: 3, priceChange5mPct: 0, priceChange1hPct: 0 };

const position = (over: Partial<Position> = {}): Position => ({
  id: 1, sessionId: 1, status: 'open', openedAt: now - 120_000, closedAt: null, amount: 1000, decimals: 6,
  entryPriceSol: 0.001, entryPriceUsd: 0.15, costSol: 1, peakPriceSol: 0.001, exitPriceSol: null, exitPriceUsd: null,
  proceedsSol: null, realizedPnlSol: null, realizedPnlUsd: null, feesSol: 0, exitReason: null, ...over,
});

test('wejście tylko w dozwolonym scenariuszu, kwota w zakresie min–max', () => {
  const d = evaluateEntry({ analysis: analysis('MODERATE_GROWTH'), snapshot, openPositions: [], lastBuyAt: null, now, cfg, rng: () => 0.5 });
  assert.equal(d.action, 'buy');
  if (d.action === 'buy') assert.ok(d.usd >= cfg.minTradeUsd && d.usd <= cfg.maxTradeUsd);
  assert.equal(evaluateEntry({ analysis: analysis('DOWNTREND'), snapshot, openPositions: [], lastBuyAt: null, now, cfg }).action, 'skip');
});

test('cooldown, limit pozycji i płynność blokują wejście', () => {
  assert.equal(evaluateEntry({ analysis: analysis('MODERATE_GROWTH'), snapshot, openPositions: [], lastBuyAt: now - 10_000, now, cfg }).action, 'skip');
  assert.equal(evaluateEntry({ analysis: analysis('MODERATE_GROWTH'), snapshot, openPositions: [position()], lastBuyAt: null, now, cfg }).action, 'skip');
  assert.equal(evaluateEntry({ analysis: analysis('MODERATE_GROWTH'), snapshot: { ...snapshot, liquidityUsd: 10 }, openPositions: [], lastBuyAt: null, now, cfg }).action, 'skip');
});

test('min. czas trzymania blokuje TP/SL, ale nie twardy stop-loss', () => {
  const young = position({ openedAt: now - 10_000 });
  assert.equal(evaluateExit({ position: young, priceSol: 0.0013, analysis: null, now, cfg }), null); // +30%, ale za wcześnie
  assert.equal(evaluateExit({ position: young, priceSol: 0.0007, analysis: null, now, cfg }), 'strategy:exit:hard_stop_loss'); // −30%
});

test('take profit, stop loss, trailing stop i wyjście na scenariuszu', () => {
  assert.equal(evaluateExit({ position: position(), priceSol: 0.00116, analysis: null, now, cfg }), 'strategy:exit:take_profit');
  assert.equal(evaluateExit({ position: position(), priceSol: 0.00089, analysis: null, now, cfg }), 'strategy:exit:stop_loss');
  assert.equal(evaluateExit({ position: position({ peakPriceSol: 0.00112 }), priceSol: 0.00102, analysis: null, now, cfg }), 'strategy:exit:trailing_stop');
  assert.equal(evaluateExit({ position: position(), priceSol: 0.001, analysis: analysis('DOWNTREND'), now, cfg }), 'strategy:exit:scenario_DOWNTREND');
});

test('maszyna stanów odrzuca niedozwolone przejścia', () => {
  const seen: string[] = [];
  const sm = new StateMachine((f, t) => seen.push(`${f}>${t}`));
  sm.transition('IDLE', 'boot');
  sm.transition('WATCHING', 'start');
  sm.transition('AWAITING_TASK', 'sygnał');
  sm.transition('BUYING', 'wykonanie');
  sm.transition('HOLDING', 'fill');
  assert.throws(() => sm.transition('OFFLINE', 'zły'), /Niedozwolone/);
  assert.deepEqual(seen, ['OFFLINE>IDLE', 'IDLE>WATCHING', 'WATCHING>AWAITING_TASK', 'AWAITING_TASK>BUYING', 'BUYING>HOLDING']);
});
