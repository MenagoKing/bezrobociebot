import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApp, stopServices } from '../src/app.ts';
import { sleep } from '../src/core/util.ts';
import { keypairFromSecret, parseSecretKey } from '../src/solana/keypair.ts';

// Dodatkowe portfele handlowe: limit pozycji na portfel, przypisanie pozycji/zleceń do portfela, rent per portfel.
const PASSWORD = 'haslo-testowe-789';
const IP = '127.0.0.1';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soldesk-tw-'));
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

test('portfele handlowe: dodanie, klucz, blokada duplikatu głównego portfela', async () => {
  await ctx.auth.setup(PASSWORD);
  const main = ctx.account.generateWallet('solana').address;
  const { wallet } = ctx.account.addTradingWallet({ kind: 'solana', source: 'generate', label: 'Portfel 2' });
  assert.equal(wallet.label, 'Portfel 2');
  assert.equal(wallet.enabled, true);
  assert.equal(ctx.account.getKeypair(wallet.id).address, wallet.address);
  const key = await ctx.account.revealTradingWallet(wallet.id, PASSWORD, IP);
  assert.equal(keypairFromSecret(parseSecretKey(key)).address, wallet.address);

  // główny portfel nie może być jednocześnie portfelem dodatkowym
  const mainKey = await ctx.account.reveal('wallet_private_key', PASSWORD, IP);
  assert.throws(() => ctx.account.addTradingWallet({ kind: 'solana', source: 'import', privateKey: mainKey }), /główny portfel/);
  assert.throws(() => ctx.account.addTradingWallet({ kind: 'solana', source: 'import', privateKey: key }), /już na liście/);

  const slots = ctx.account.walletSlots('solana', { requireKey: true });
  assert.deepEqual(slots.map((s) => s.address), [main, wallet.address]);
  ctx.account.updateTradingWallet(wallet.id, { enabled: false });
  assert.equal(ctx.account.walletSlots('solana', { requireKey: true }).length, 1);
  ctx.account.updateTradingWallet(wallet.id, { enabled: true });
});

test('limit 1 pozycji na portfel: każda pozycja z innego portfela, sprzedaż z portfela pozycji', async () => {
  ctx.callouts.init();
  await ctx.coordinator.init();
  ctx.settings.update('trading', { entryScenarios: [], evaluationIntervalSeconds: 60, maxOpenPositions: 5, maxPositionsPerWallet: 1, buyCooldownSeconds: 0 });
  ctx.settings.update('risk', { maxDeployedUsd: 100, maxSessionLossUsd: 0, maxSessionLossPct: 0, maxCostsUsd: 0 });
  const extraId = ctx.account.get().tradingWallets[0]!.id;

  const session = await ctx.coordinator.startSession({
    tokenAddress: 'So11111111111111111111111111111111111111112',
    mode: 'paper',
    dataSource: 'simulated',
    startingCapitalUsd: 10,
  });

  const first = ctx.coordinator.manualBuy(1);
  assert.equal(first.walletId, 0);
  // drugie kupno, zanim pierwsze się wykona: zlecenie w kolejce też zajmuje portfel główny
  const second = ctx.coordinator.manualBuy(1);
  assert.equal(second.walletId, extraId);
  assert.throws(() => ctx.coordinator.manualBuy(1), /limit na portfel/);

  await waitFor(() => ctx.repo.listOpenPositions(session.id).length === 2);
  const open = ctx.repo.listOpenPositions(session.id);
  assert.deepEqual(open.map((p) => p.walletId).sort((a, b) => a - b), [0, extraId]);

  // rent za konto tokena naliczany osobno dla każdego portfela
  const t = ctx.settings.get().trading;
  assert.ok(Math.abs(ctx.repo.getSession(session.id)!.rentPaidSol - 2 * t.paperAtaRentSol) < 1e-12);

  // portfela z otwartą pozycją nie można usunąć
  await assert.rejects(ctx.account.removeTradingWallet(extraId, PASSWORD, IP), /otwartą pozycję/);

  const onExtra = open.find((p) => p.walletId === extraId)!;
  const sell = ctx.coordinator.manualSell(onExtra.id);
  assert.equal(sell.walletId, extraId);
  await waitFor(() => ctx.repo.listOpenPositions(session.id).length === 1);

  // zwolniony portfel znowu przyjmuje pozycję
  assert.equal(ctx.coordinator.manualBuy(1).walletId, extraId);
  await waitFor(() => ctx.repo.listOpenPositions(session.id).length === 2);

  await ctx.coordinator.stop({ liquidate: true });

  // po zakończeniu sesji portfel można usunąć — klucz trafia do archiwum
  const address = ctx.account.get().tradingWallets[0]!.address;
  const acc = await ctx.account.removeTradingWallet(extraId, PASSWORD, IP);
  assert.equal(acc.tradingWallets.length, 0);
  assert.ok(acc.archivedWallets.some((a) => a.address === address));
});
