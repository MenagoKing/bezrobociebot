import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';

type Param = SQLInputValue | boolean | undefined;

function norm(p: Param): SQLInputValue {
  if (p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  return p;
}

/** Cienka warstwa nad node:sqlite: cache zapytań, transakcje, migracje. */
export class Db {
  readonly raw: DatabaseSync;
  readonly file: string;
  private cache = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(file: string) {
    this.file = file;
    this.raw = new DatabaseSync(file);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
  }

  migrate(): number {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.get<{ version: number }>('SELECT version FROM schema_version LIMIT 1');
    let version = row?.version ?? 0;
    if (!row) this.run('INSERT INTO schema_version (version) VALUES (0)');
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[i]!);
        this.run('UPDATE schema_version SET version = ?', i + 1);
      });
      version = i + 1;
    }
    return version;
  }

  private prepare(sql: string): StatementSync {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.prepare(sql).run(...params.map(norm));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.prepare(sql).get(...params.map(norm)) as T | undefined;
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.prepare(sql).all(...params.map(norm)) as T[];
  }

  /** Transakcja (zagnieżdżone wywołania dołączają do zewnętrznej). */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  /** Spójna kopia bazy (działa przy pracującej aplikacji). */
  backupTo(destination: string): void {
    this.raw.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}
