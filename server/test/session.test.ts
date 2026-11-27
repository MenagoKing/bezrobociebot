import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApp, stopServices } from '../src/app.ts';
import { sleep } from '../src/core/util.ts';

// Pełny przebieg sesji paper na symulowanym rynku: koordynator → kolejka → wykonawca → księga → statystyki.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soldesk-test-'));
const ctx = createApp({ dbFile: path.join(dir, 'test.db') });
after(() => {
  stopServices(ctx);
  ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error('timeout');
}

test('sesja paper: start, ręczne kupno i sprzedaż, spójna księga i statystyki, zatrzymanie', async () => {
  ctx.callouts.init();
  await ctx.coordinator.init();
  // strategia nie powinna sama wchodzić w trakcie testu
  ctx.settings.update('trading', { entryScenarios: [], evaluationIntervalSeconds: 60 });

  const session = await ctx.coordinator.startSession({
    tokenAddress: 'So11111111111111111111111111111111111111112',
    mode: 'paper',
    dataSource: 'simulated',
    startingCapitalUsd: 2,
  });
  assert.equal(session.status, 'running');
  assert.ok(ctx.market.snapshot, 'feed powinien mieć cenę');
  assert.equal(ctx.engine.state, 'WATCHING');

  // limit ryzyka: kwota powyżej maksimum
  assert.throws(() => ctx.coordinator.manualBuy(5), /maksimum/);

  ctx.coordinator.manualBuy(1);
  await waitFor(() => ctx.repo.listOpenPositions(session.id).length === 1);
  await waitFor(() => ctx.engine.state === 'HOLDING');
  const pos = ctx.repo.listOpenPositions(session.id)[0]!;
  const afterBuy = ctx.repo.getSession(session.id)!;
  const trade = ctx.repo.listTrades({ sessionId: session.id })[0]!;
  // saldo = kapitał − wartość − opłata sieci − rent
  const t = ctx.settings.get().trading;
  const expected = session.paperBalanceSol - trade.valueSol - trade.networkFeeSol - t.paperAtaRentSol;
  assert.ok(Math.abs(afterBuy.paperBalanceSol - expected) < 1e-12);
  assert.ok(Math.abs(pos.costSol - (trade.valueSol + trade.networkFeeSol)) < 1e-12);

  ctx.coordinator.manualSell(pos.id);
  await waitFor(() => ctx.repo.listOpenPositions(session.id).length === 0);
  const closed = ctx.repo.getPosition(pos.id)!;
  assert.equal(closed.status, 'closed');
  assert.ok(closed.realizedPnlSol !== null);

  const stats = ctx.coordinator.currentStats()!;
  assert.equal(stats.buys, 1);
  assert.equal(stats.sells, 1);
  // kapitał końcowy = początkowy + wynik zrealizowany − rent
  assert.ok(Math.abs(stats.currentCapital.sol - (session.startCapitalSol + closed.realizedPnlSol! - t.paperAtaRentSol)) < 1e-12);
  assert.ok(stats.totalCosts.sol > 0);

  // ogłoszenia wygenerowane z rzeczywistych transakcji, z etykietą AUTO
  const callouts = ctx.repo.listCallouts();
  assert.ok(callouts.length >= 2);
  assert.ok(callouts.every((c) => c.body.includes(ctx.settings.get().callouts.autoLabel)));

  const ended = await ctx.coordinator.stop({ liquidate: true });
  assert.equal(ended.status, 'stopped');
  assert.ok(ended.summary);
  assert.equal(ctx.engine.state, 'IDLE');
});

test('awaryjne zatrzymanie likwiduje otwarte pozycje', async () => {
  const session = await ctx.coordinator.startSession({
    tokenAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    mode: 'paper',
    dataSource: 'simulated',
  });
  ctx.coordinator.manualBuy(0.5);
  await waitFor(() => ctx.repo.listOpenPositions(session.id).length === 1);
  const ended = await ctx.coordinator.emergencyStop();
  assert.equal(ended.status, 'emergency_stopped');
  assert.equal(ctx.repo.listOpenPositions(session.id).length, 0);
});
