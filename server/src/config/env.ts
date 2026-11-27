import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '../../..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Zmienna ${name} musi być liczbą`);
  return n;
}

export const env = {
  rootDir,
  port: num('PORT', 8787),
  host: process.env.HOST ?? '127.0.0.1',
  // testy (node --test ustawia NODE_TEST_CONTEXT) nie piszą do prawdziwego katalogu danych
  dataDir: path.resolve(
    rootDir,
    process.env.DATA_DIR ?? (process.env.NODE_TEST_CONTEXT ? path.join(os.tmpdir(), 'soldesk-test-data') : 'data'),
  ),
  webDist: path.join(rootDir, 'web', 'dist'),
  masterKey: process.env.MASTER_KEY || null,
  trustProxy: process.env.TRUST_PROXY === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // Twardy wyłącznik po stronie serwera: bez tej flagi tryb live jest niedostępny.
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
};

fs.mkdirSync(env.dataDir, { recursive: true });
