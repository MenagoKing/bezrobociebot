import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp, stopServices } from '../src/app.ts';
import { sleep } from '../src/core/util.ts';
import { checkQuote, type LifiQuote } from '../src/evm/lifi.ts';
import { computeEvmFill } from '../src/execution/evmExecutor.ts';
import { parseTokenInput } from '../src/market/provider.ts';
import { parseEvmPrivateKey } from '../src/services/accountService.ts';

const TOKEN = '0xce95E835b149024530F0667e9F2CF34dc5E31C11';
const ROUTER = '0xB477751B76CF82d00a686A1232f5fCD772414Af3';
const ME = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23';

test('rozpoznawanie adresu: EVM, link DexScreener, ID puli v4 (nie adres), Solana', () => {
  assert.deepEqual(parseTokenInput(TOKEN), { kind: 'evm', address: TOKEN });
  assert.deepEqual(parseTokenInput(`https://dexscreener.com/robinhood/${TOKEN}`), { kind: 'evm', address: TOKEN });
  const poolId = '0xd6ff25e4f340275e9050962b386d97dc7115dd77167828a32819d25ea13a6847';
  assert.equal(parseTokenInput(`https://dexscreener.com/robinhood/${poolId}`)?.kind === 'evm', false);
  assert.equal(parseTokenInput('EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm')?.kind, 'solana');
});

test('klucz EVM: format z 0x i bez, adres zgodny ze znanym wektorem', () => {
  const key = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
  assert.equal(parseEvmPrivateKey(key), `0x${key}`);
  assert.equal(parseEvmPrivateKey(`0x${key.toUpperCase()}`), `0x${key}`);
  assert.equal(privateKeyToAccount(parseEvmPrivateKey(key)).address, ME);
  assert.throws(() => parseEvmPrivateKey('0x1234'));
});

test('wykonanie EVM z różnic sald: kupno i sprzedaż z kosztem gazu i approve', () => {
  const e18 = 10n ** 18n;
  const buy = computeEvmFill({
    side: 'buy',
    nativeBefore: e18,
    nativeAfter: e18 - 1_000_000_000_000_000n - 20_000_000_000_000n, // 0.001 ETH + 0.00002 gazu
    tokenBefore: 0n,
    tokenAfter: 158_000_000n, // 0.158 tokena (9 miejsc)
    gasCostWei: 20_000_000_000_000n,
    extraGasWei: 0n,
    decimals: 9,
    txHash: '0xabc',
  });
  assert.equal(buy.amount, 0.158);
  assert.ok(Math.abs(buy.valueSol - 0.001) < 1e-15);
  assert.ok(Math.abs(buy.networkFeeSol - 0.00002) < 1e-15);
  assert.equal(buy.rentSol, 0);

  const sell = computeEvmFill({
    side: 'sell',
    nativeBefore: e18,
    nativeAfter: e18 + 950_000_000_000_000n - 30_000_000_000_000n, // otrzymano 0.00095, gaz 0.00003
    tokenBefore: 158_000_000n,
    tokenAfter: 0n,
    gasCostWei: 30_000_000_000_000n,
    extraGasWei: 10_000_000_000_000n, // approve w osobnej transakcji
    decimals: 9,
    txHash: '0xdef',
  });
  assert.ok(Math.abs(sell.valueSol - 0.00095) < 1e-15);
  assert.ok(Math.abs(sell.networkFeeSol - 0.00004) < 1e-15);
  assert.throws(() => computeEvmFill({ ...{ side: 'buy', nativeBefore: 1n, nativeAfter: 0n, tokenBefore: 5n, tokenAfter: 5n, gasCostWei: 0n, extraGasWei: 0n, decimals: 9, txHash: '' } }), /nie zwiększyła/);
});

test('kontrola wyceny LI.FI: sieć, nadawca, kwota, allowlista, approve, minimalna ilość', () => {
  const quote = (over: Partial<LifiQuote['transactionRequest']> = {}, est: Partial<LifiQuote['estimate']> = {}): LifiQuote => ({
    estimate: { toAmount: '100', toAmountMin: '95', approvalAddress: ROUTER, ...est },
    transactionRequest: { to: ROUTER, data: '0x1234', value: '0x38d7ea4c68000', chainId: 4663, from: ME, ...over },
  });
  const ok = { chainId: 4663, from: ME, expectValue: 1_000_000_000_000_000n, allowlist: [ROUTER], needsApproval: false };
  assert.doesNotThrow(() => checkQuote(quote(), ok));
  assert.throws(() => checkQuote(quote({ chainId: 1 }), ok), /innej sieci/);
  assert.throws(() => checkQuote(quote({ from: TOKEN }), ok), /innego portfela/);
  assert.throws(() => checkQuote(quote({ value: '0x1' }), ok), /Kwota/);
  assert.throws(() => checkQuote(quote({ to: TOKEN }), ok), /allowlisty/);
  assert.throws(() => checkQuote(quote({ value: '0x0' }, { approvalAddress: TOKEN }), { ...ok, expectValue: 0n, needsApproval: true }), /Approve/);
  assert.throws(() => checkQuote(quote({}, { toAmountMin: '0' }), ok), /zerową/);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soldesk-evm-'));
const ctx = createApp({ dbFile: path.join(dir, 'test.db') });
after(() => {
  stopServices(ctx);
  ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sesja paper na sieci EVM (symulator): waluta ETH, bez rentu, opłata gazu z konfiguracji sieci', async () => {
  await ctx.coordinator.init();
  ctx.settings.update('trading', { entryScenarios: [], evaluationIntervalSeconds: 60 });
  const session = await ctx.coordinator.startSession({ tokenAddress: TOKEN, mode: 'paper', dataSource: 'simulated', startingCapitalUsd: 5 });
  assert.equal(session.chain, 'robinhood');
  assert.equal(session.nativeSymbol, 'ETH');
  assert.ok(Math.abs(session.startCapitalSol - 5 / 1700) < 1e-12);

  ctx.coordinator.manualBuy(1);
  for (let i = 0; i < 100 && ctx.repo.listOpenPositions(session.id).length === 0; i++) await sleep(50);
  const trade = ctx.repo.listTrades({ sessionId: session.id })[0]!;
  const gas = ctx.settings.get().evm.chains.find((c) => c.key === 'robinhood')!.paperGasFeeNative;
  assert.equal(trade.networkFeeSol, gas);
  assert.equal(trade.nativeSymbol, 'ETH');
  const s = ctx.repo.getSession(session.id)!;
  assert.equal(s.rentPaidSol, 0);
  assert.ok(Math.abs(s.paperBalanceSol - (session.paperBalanceSol - trade.valueSol - gas)) < 1e-15);
  assert.equal(ctx.coordinator.currentStats()?.nativeSymbol, 'ETH');

  const ended = await ctx.coordinator.stop({ liquidate: true });
  assert.equal(ended.status, 'stopped');
  assert.equal(ctx.repo.listOpenPositions(session.id).length, 0);
});

test('portfel bota: generowanie (Solana i EVM), brak nadpisania, usuwanie klucza', async () => {
  const sol = ctx.account.generateWallet('solana');
  assert.match(sol.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(ctx.account.get().walletAddress, sol.address);
  assert.equal(ctx.account.getKeypair().address, sol.address);
  const evm = ctx.account.generateWallet('evm');
  assert.match(evm.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(ctx.account.getEvmAccount().address, evm.address);
  assert.throws(() => ctx.account.generateWallet('evm'), /już istnieje/);
  // klucz jest zaszyfrowany w bazie (nie występuje jawnie)
  const blob = ctx.repo.getSecret('evm_private_key')!;
  assert.ok(!blob.includes(evm.address.slice(2, 10)));

  await ctx.account.deleteSecret('evm_private_key');
  assert.equal(ctx.account.hasEvmKey(), false);
  // po usunięciu można wygenerować nowy portfel
  assert.notEqual(ctx.account.generateWallet('evm').address, evm.address);
});
