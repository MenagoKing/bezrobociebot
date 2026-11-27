import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { test } from 'node:test';
import { sanitize } from '../src/core/logger.ts';
import { Vault } from '../src/security/vault.ts';
import { base58Decode, base58Encode } from '../src/solana/base58.ts';
import { keypairFromSecret, parseSecretKey } from '../src/solana/keypair.ts';
import { inspectTransaction, signSerializedTransaction } from '../src/solana/transaction.ts';

function newSolanaSecret(): Uint8Array {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return new Uint8Array(Buffer.concat([seed, pub]));
}

test('vault: szyfrowanie i odszyfrowanie, AAD wiąże sekret z nazwą', () => {
  const v = Vault.forTests(randomBytes(32));
  const blob = v.encrypt('tajne', 'wallet_private_key');
  assert.notEqual(blob, 'tajne');
  assert.equal(v.decrypt(blob, 'wallet_private_key'), 'tajne');
  assert.throws(() => v.decrypt(blob, 'rpc_url'));
});

test('base58: kodowanie w obie strony (z zerami wiodącymi)', () => {
  const bytes = new Uint8Array([0, 0, 1, 2, 3, 250, 251]);
  assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  assert.equal(base58Encode(base58Decode('So11111111111111111111111111111111111111112')), 'So11111111111111111111111111111111111111112');
});

test('keypair: format base58 i JSON, wykrywanie uszkodzonego klucza', () => {
  const secret = newSolanaSecret();
  const a = keypairFromSecret(parseSecretKey(base58Encode(secret)));
  const b = keypairFromSecret(parseSecretKey(JSON.stringify([...secret])));
  assert.equal(a.address, b.address);
  assert.equal(a.address, base58Encode(secret.subarray(32)));
  const broken = new Uint8Array(secret);
  broken[40] ^= 0xff;
  assert.throws(() => keypairFromSecret(broken), /uszkodzony/);
});

test('podpis transakcji: poprawny podpis ed25519 w slocie płatnika; cudza transakcja odrzucona', () => {
  const kp = keypairFromSecret(newSolanaSecret());
  const other = randomBytes(32);
  // transakcja legacy: 1 podpis, nagłówek [1,0,1], 2 klucze, blockhash, 0 instrukcji
  const message = Buffer.concat([Buffer.from([1, 0, 1, 2]), Buffer.from(kp.publicKey), other, randomBytes(32), Buffer.from([0])]);
  const tx = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
  const info = inspectTransaction(new Uint8Array(tx));
  assert.equal(info.staticAccountKeys[0], kp.address);
  const { signed, signature } = signSerializedTransaction(tx.toString('base64'), kp);
  const signedBytes = Buffer.from(signed, 'base64');
  const sig = signedBytes.subarray(1, 65);
  assert.equal(base58Encode(sig), signature);
  const pubKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(kp.publicKey)]), format: 'der', type: 'spki' });
  assert.equal(verify(null, signedBytes.subarray(65), pubKey, sig), true);

  const foreign = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), Buffer.from([1, 0, 1, 2]), other, Buffer.from(kp.publicKey), randomBytes(32), Buffer.from([0])]);
  assert.throws(() => signSerializedTransaction(foreign.toString('base64'), kp), /płatnikiem/);
});

test('sanitize usuwa klucze i api-key z tekstu logów', () => {
  const secret = base58Encode(newSolanaSecret());
  const text = sanitize(`klucz ${secret} url https://rpc.example.com/?api-key=abc123`);
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes('abc123'));
});
