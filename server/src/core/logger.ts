import fs from 'node:fs';
import path from 'node:path';
import { pino } from 'pino';
import { env } from '../config/env.ts';

const LOG_DIR = path.join(env.dataDir, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const KEEP_ROTATED = 5;

function rotateIfLarge(): void {
  try {
    if (!fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size < MAX_LOG_BYTES) return;
    for (let i = KEEP_ROTATED - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${LOG_FILE}.${i + 1}`);
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // rotacja nie może zatrzymać startu
  }
}

fs.mkdirSync(LOG_DIR, { recursive: true });
rotateIfLarge();

/**
 * Usuwa z tekstu rzeczy przypominające sekrety: klucze prywatne (base58 64 B / tablica 64 liczb),
 * parametry api-key w URL-ach, nagłówki autoryzacji.
 */
export function sanitize(text: string): string {
  return text
    .replace(/(api[-_]?key=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/g, '[REDACTED_64B]')
    .replace(/\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/g, '[REDACTED_KEY]');
}

export const logger = pino(
  {
    level: env.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.newPassword',
        '*.privateKey',
        '*.secretKey',
        '*.secret',
        '*.mnemonic',
      ],
      censor: '[REDACTED]',
    },
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: pino.destination({ dest: LOG_FILE, mkdir: true, sync: false }) },
  ]),
);

export type Logger = typeof logger;
export { LOG_FILE };
