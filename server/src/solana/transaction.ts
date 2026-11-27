import { base58Encode } from './base58.ts';
import type { SolanaKeypair } from './keypair.ts';

function readShortVec(buf: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let size = 0;
  for (;;) {
    const byte = buf[offset + size];
    if (byte === undefined) throw new Error('Uszkodzona transakcja (compact-u16)');
    value |= (byte & 0x7f) << (size * 7);
    size++;
    if ((byte & 0x80) === 0) break;
    if (size > 3) throw new Error('Uszkodzona transakcja (compact-u16 za długi)');
  }
  return [value, offset + size];
}

export interface TxInfo {
  numSignatures: number;
  signaturesOffset: number;
  messageOffset: number;
  version: 'legacy' | number;
  numRequiredSignatures: number;
  staticAccountKeys: string[];
}

/** Odczyt nagłówka transakcji (legacy lub v0) bez zewnętrznych bibliotek. */
export function inspectTransaction(tx: Uint8Array): TxInfo {
  const [numSignatures, sigStart] = readShortVec(tx, 0);
  const messageOffset = sigStart + numSignatures * 64;
  let o = messageOffset;
  let version: 'legacy' | number = 'legacy';
  if (tx[o]! & 0x80) {
    version = tx[o]! & 0x7f;
    o++;
  }
  const numRequiredSignatures = tx[o]!;
  o += 3; // nagłówek: required, readonlySigned, readonlyUnsigned
  const [numKeys, keysStart] = readShortVec(tx, o);
  const keys: string[] = [];
  for (let i = 0; i < numKeys; i++) {
    keys.push(base58Encode(tx.subarray(keysStart + i * 32, keysStart + (i + 1) * 32)));
  }
  return { numSignatures, signaturesOffset: sigStart, messageOffset, version, numRequiredSignatures, staticAccountKeys: keys };
}

/**
 * Podpisuje transakcję zwróconą przez agregator. Zabezpieczenia: płatnikiem opłat musi być nasz
 * portfel, a jedynym wymaganym podpisem — nasz (nie podpisujemy cudzych transakcji wieloosobowych).
 */
export function signSerializedTransaction(base64Tx: string, keypair: SolanaKeypair): { signed: string; signature: string } {
  const tx = new Uint8Array(Buffer.from(base64Tx, 'base64'));
  const info = inspectTransaction(tx);
  if (info.staticAccountKeys[0] !== keypair.address) {
    throw new Error('Transakcja odrzucona: płatnikiem opłat nie jest skonfigurowany portfel');
  }
  if (info.numRequiredSignatures !== 1 || info.numSignatures !== 1) {
    throw new Error(`Transakcja odrzucona: wymaga ${info.numRequiredSignatures} podpisów (oczekiwano 1)`);
  }
  const signature = keypair.sign(tx.subarray(info.messageOffset));
  tx.set(signature, info.signaturesOffset);
  return { signed: Buffer.from(tx).toString('base64'), signature: base58Encode(signature) };
}
