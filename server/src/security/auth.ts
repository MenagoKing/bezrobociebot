import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Repository } from '../db/repository.ts';
import { UserError } from '../core/util.ts';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
const MIN_PASSWORD = 10;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Uwierzytelnianie jedynego administratora: hasło (scrypt) + sesje w ciasteczku. */
export class AuthService {
  private failures = new Map<string, { count: number; resetAt: number }>();
  private repo: Repository;
  private ttlMs: number;

  constructor(repo: Repository, ttlHours: number) {
    this.repo = repo;
    this.ttlMs = ttlHours * 3600_000;
  }

  async bootstrap(envPassword: string | null): Promise<void> {
    if (!this.repo.getAdminHash() && envPassword) {
      this.assertStrong(envPassword);
      this.repo.setAdminHash(await hashPassword(envPassword));
    }
  }

  isSetupRequired(): boolean {
    return !this.repo.getAdminHash();
  }

  private assertStrong(password: string): void {
    if (password.length < MIN_PASSWORD) throw new UserError(`Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków`);
  }

  async setup(password: string): Promise<void> {
    if (!this.isSetupRequired()) throw new UserError('Administrator już istnieje', 409);
    this.assertStrong(password);
    this.repo.setAdminHash(await hashPassword(password));
  }

  private checkRateLimit(ip: string): void {
    const entry = this.failures.get(ip);
    if (entry && entry.resetAt > Date.now() && entry.count >= 5) {
      const minutes = Math.ceil((entry.resetAt - Date.now()) / 60_000);
      throw new UserError(`Za dużo nieudanych prób. Spróbuj za ${minutes} min.`, 429);
    }
  }

  private recordFailure(ip: string): void {
    const now = Date.now();
    const entry = this.failures.get(ip);
    if (!entry || entry.resetAt < now) this.failures.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    else entry.count++;
  }

  /** Sprawdza hasło (z limitem prób) — używane przy logowaniu i podglądzie sekretów. */
  async checkPassword(password: string, ip: string): Promise<void> {
    this.checkRateLimit(ip);
    const hash = this.repo.getAdminHash();
    if (!hash || !(await verifyPassword(password, hash))) {
      this.recordFailure(ip);
      throw new UserError('Nieprawidłowe hasło', 401);
    }
    this.failures.delete(ip);
  }

  async login(password: string, ip: string): Promise<{ token: string; expiresAt: number }> {
    await this.checkPassword(password, ip);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.repo.purgeExpiredAuthSessions();
    this.repo.createAuthSession(sha256(token), expiresAt, ip);
    return { token, expiresAt };
  }

  validate(token: string | undefined): boolean {
    if (!token) return false;
    const expiresAt = this.repo.getAuthSessionExpiry(sha256(token));
    return expiresAt !== null && expiresAt > Date.now();
  }

  logout(token: string | undefined): void {
    if (token) this.repo.deleteAuthSession(sha256(token));
  }

  async changePassword(current: string, next: string, ip: string): Promise<void> {
    await this.checkPassword(current, ip);
    this.assertStrong(next);
    this.repo.setAdminHash(await hashPassword(next));
    this.repo.deleteAllAuthSessions();
  }
}
