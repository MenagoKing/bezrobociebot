import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Szyfrowanie sekretów AES-256-GCM. Klucz główny pochodzi z MASTER_KEY (base64, 32 B)
 * albo z pliku data/master.key (tworzony przy pierwszym uruchomieniu).
 * Klucz NIE jest przechowywany w bazie — kopia bazy bez klucza nie ujawnia sekretów.
 */
export class Vault {
  private key: Buffer;

  private constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('Klucz główny musi mieć 32 bajty');
    this.key = key;
  }

  static load(masterKeyB64: string | null, dataDir: string, warn: (msg: string) => void): Vault {
    if (masterKeyB64) return new Vault(Buffer.from(masterKeyB64, 'base64'));
    const file = path.join(dataDir, 'master.key');
    if (fs.existsSync(file)) return new Vault(Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64'));
    const key = randomBytes(32);
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    warn(`Utworzono nowy klucz główny w ${file}. Zrób jego kopię w bezpiecznym miejscu — bez niego sekretów nie da się odszyfrować.`);
    return new Vault(key);
  }

  static forTests(key: Buffer): Vault {
    return new Vault(key);
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  decrypt(blob: string, aad: string): string {
    const buf = Buffer.from(blob, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }
}
