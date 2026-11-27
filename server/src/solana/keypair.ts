import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { base58Decode, base58Encode } from './base58.ts';

// Prefiks DER PKCS#8 dla klucza Ed25519 (po nim następuje 32-bajtowe ziarno).
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface SolanaKeypair {
  readonly address: string;
  readonly publicKey: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
}

/**
 * Klucz prywatny wpisany przez użytkownika: base58 albo tablica JSON (Phantom, pump.fun, solana-keygen) — zawsze 64 bajty
 * (ziarno + klucz publiczny, sprawdzane w keypairFromSecret). 32 bajty są odrzucane: tyle samo ma adres portfela, więc
 * wklejony omyłkowo adres zostałby potraktowany jak ziarno i dałby obcy portfel, którego klucz każdy może wyliczyć.
 */
export function parseSecretKey(input: string): Uint8Array {
  const text = input.trim();
  let bytes: Uint8Array;
  if (text.startsWith('[')) {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr) || !arr.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      throw new Error('Nieprawidłowy format klucza (tablica JSON)');
    }
    bytes = Uint8Array.from(arr as number[]);
  } else {
    bytes = base58Decode(text);
  }
  if (bytes.length === 32) {
    throw new Error(
      'to jest adres portfela (klucz publiczny), a nie klucz prywatny. Klucz prywatny Solany ma 87–88 znaków — wyeksportuj go z pump.fun lub Phantoma',
    );
  }
  if (bytes.length !== 64) throw new Error('klucz prywatny Solany musi mieć 64 bajty (87–88 znaków base58 albo tablica JSON z 64 liczbami)');
  return bytes;
}

/** Nowy klucz Solany (64 B: ziarno + klucz publiczny — format zgodny z Phantom/solana-keygen). */
export function generateSolanaSecret(): Uint8Array {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return new Uint8Array(Buffer.concat([seed, pub]));
}

export function keypairFromSecret(secret: Uint8Array): SolanaKeypair {
  const seed = secret.subarray(0, 32);
  const privateKey: KeyObject = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));
  if (secret.length === 64 && !Buffer.from(secret.subarray(32)).equals(Buffer.from(publicKey))) {
    throw new Error('Klucz uszkodzony: część publiczna nie pasuje do prywatnej');
  }
  return {
    address: base58Encode(publicKey),
    publicKey,
    sign: (message: Uint8Array) => new Uint8Array(sign(null, message, privateKey)),
  };
}
