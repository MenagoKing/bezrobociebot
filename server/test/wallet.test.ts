import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApp, stopServices } from '../src/app.ts';
import { keypairFromSecret, parseSecretKey } from '../src/solana/keypair.ts';

const PASSWORD = 'haslo-testowe-456';
const IP = '127.0.0.1';
const EVM_KEY = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const EVM_ADDR = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soldesk-wallet-'));
const ctx = createApp({ dbFile: path.join(dir, 'test.db') });
after(() => {
  stopServices(ctx);
  ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('zmiana portfela Solana: hasło, archiwum starego klucza, powrót z archiwum', async () => {
  await ctx.auth.setup(PASSWORD);
  const first = ctx.account.generateWallet('solana').address;

  await assert.rejects(ctx.account.changeWallet({ kind: 'solana', source: 'generate', password: 'zle-haslo-000' }, IP), /Nieprawidłowe/);
  assert.equal(ctx.account.get().walletAddress, first);

  const changed = await ctx.account.changeWallet({ kind: 'solana', source: 'generate', password: PASSWORD }, IP);
  assert.notEqual(changed.address, first);
  assert.equal(changed.previousAddress, first);
  assert.equal(ctx.account.get().walletAddress, changed.address);
  assert.equal(ctx.account.getKeypair().address, changed.address); // pamięć podręczna klucza wyczyszczona

  const archived = ctx.account.get().archivedWallets;
  assert.equal(archived.length, 1);
  assert.deepEqual([archived[0]!.kind, archived[0]!.address], ['solana', first]);
  // klucz z archiwum nadal otwiera stary adres (dostęp do środków zostaje)
  const oldKey = await ctx.account.revealArchived(archived[0]!.id, PASSWORD, IP);
  assert.equal(keypairFromSecret(parseSecretKey(oldKey)).address, first);

  // import obecnego klucza = brak zmiany
  const currentKey = await ctx.account.reveal('wallet_private_key', PASSWORD, IP);
  await assert.rejects(ctx.account.changeWallet({ kind: 'solana', source: 'import', privateKey: currentKey, password: PASSWORD }, IP), /obecny portfel/);
  // zwykły zapis sekretu nie podmienia portfela po cichu
  assert.throws(() => ctx.account.setSecret('wallet_private_key', oldKey), /Zmień portfel/);

  // powrót do pierwszego portfela: zamiana miejscami w archiwum, bez duplikatów
  const back = await ctx.account.changeWallet({ kind: 'solana', source: 'archive', archiveId: archived[0]!.id, password: PASSWORD }, IP);
  assert.equal(back.address, first);
  assert.equal(ctx.account.getKeypair().address, first);
  const after = ctx.account.get().archivedWallets;
  assert.deepEqual(after.map((a) => a.address), [changed.address]);

  await assert.rejects(ctx.account.changeWallet({ kind: 'solana', source: 'archive', archiveId: 9999, password: PASSWORD }, IP), /archiwum/);
  await assert.rejects(ctx.account.changeWallet({ kind: 'solana', source: 'import', privateKey: 'nie-klucz', password: PASSWORD }, IP), /Nieprawidłowy klucz Solana/);

  await assert.rejects(ctx.account.deleteArchived(after[0]!.id, 'zle-haslo-000', IP), /Nieprawidłowe/);
  await ctx.account.deleteArchived(after[0]!.id, PASSWORD, IP);
  assert.equal(ctx.account.get().archivedWallets.length, 0);
});

test('zmiana portfela EVM: import własnego klucza, archiwum tylko gdy był poprzedni klucz', async () => {
  const generated = ctx.account.generateWallet('evm').address;
  const imported = await ctx.account.changeWallet({ kind: 'evm', source: 'import', privateKey: `0x${EVM_KEY}`, password: PASSWORD }, IP);
  assert.equal(imported.address, EVM_ADDR);
  assert.equal(ctx.account.get().evmWalletAddress, EVM_ADDR);
  assert.equal(ctx.account.getEvmAccount().address, EVM_ADDR);
  const archived = ctx.account.get().archivedWallets.filter((a) => a.kind === 'evm');
  assert.deepEqual(archived.map((a) => a.address), [generated]);
  // ten sam klucz bez 0x = ten sam portfel
  await assert.rejects(ctx.account.changeWallet({ kind: 'evm', source: 'import', privateKey: EVM_KEY, password: PASSWORD }, IP), /obecny portfel/);

  // bez klucza (po usunięciu) zmiana działa jak import, a archiwum się nie powiększa
  await ctx.account.deleteSecret('evm_private_key', PASSWORD, IP);
  const restored = await ctx.account.changeWallet({ kind: 'evm', source: 'archive', archiveId: archived[0]!.id, password: PASSWORD }, IP);
  assert.equal(restored.previousAddress, null);
  assert.equal(ctx.account.getEvmAccount().address, generated);
  assert.equal(ctx.account.get().archivedWallets.filter((a) => a.kind === 'evm').length, 0);
});
