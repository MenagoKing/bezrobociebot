import type { ErrorEntry } from '../../../shared/types.ts';
import type { Repository } from '../db/repository.ts';
import type { EventBus } from './eventBus.ts';
import { logger, sanitize } from './logger.ts';
import { errorMessage } from './util.ts';

/**
 * Centralny monitor błędów: zapis do bazy (bez sekretów), log, zdarzenie dla panelu.
 * Powtarzające się identyczne błędy są dławione, żeby awaria feedu nie zalała bazy.
 */
export class ErrorMonitor {
  private lastByKey = new Map<string, number>();
  private repo: Repository;
  private bus: EventBus;

  constructor(repo: Repository, bus: EventBus) {
    this.repo = repo;
    this.bus = bus;
  }

  record(
    source: string,
    err: unknown,
    opts: { level?: ErrorEntry['level']; context?: Record<string, unknown>; throttleMs?: number } = {},
  ): void {
    const level = opts.level ?? 'error';
    const message = sanitize(errorMessage(err)).slice(0, 1000);
    const key = `${source}|${message}`;
    const now = Date.now();
    const throttle = opts.throttleMs ?? 30_000;
    const last = this.lastByKey.get(key);
    const logPayload = { source, context: opts.context };
    if (level === 'error') logger.error(logPayload, message);
    else logger.warn(logPayload, message);
    if (last && now - last < throttle) return;
    this.lastByKey.set(key, now);
    if (this.lastByKey.size > 500) this.lastByKey.clear();
    try {
      const context = opts.context ? JSON.parse(sanitize(JSON.stringify(opts.context))) : null;
      const entry = this.repo.insertError({ ts: now, level, source, message, context });
      this.bus.emit('error', entry);
    } catch (dbErr) {
      logger.error({ err: errorMessage(dbErr) }, 'Nie udało się zapisać błędu');
    }
  }

  /** Uruchamia funkcję i przechwytuje błąd — awaria modułu nie przerywa reszty systemu. */
  async safeRun<T>(source: string, fn: () => Promise<T> | T): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      this.record(source, err);
      return undefined;
    }
  }
}
