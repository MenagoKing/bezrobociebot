import fs from 'node:fs';
import path from 'node:path';
import type { SettingsService } from '../config/settingsService.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import { logger } from '../core/logger.ts';
import type { Db } from '../db/database.ts';
import type { Repository } from '../db/repository.ts';

/** Kopie zapasowe bazy (VACUUM INTO — spójne przy działającej aplikacji) z rotacją. */
export class BackupService {
  readonly dir: string;
  private timer: NodeJS.Timeout | null = null;
  private db: Db;
  private repo: Repository;
  private settings: SettingsService;
  private errors: ErrorMonitor;

  constructor(db: Db, repo: Repository, settings: SettingsService, errors: ErrorMonitor, dataDir: string) {
    this.db = db;
    this.repo = repo;
    this.settings = settings;
    this.errors = errors;
    this.dir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  start(): void {
    // sprawdzamy co 10 min, czy minął interwał — zmiana ustawienia działa bez restartu
    const check = () => {
      const hours = this.settings.get().system.backupIntervalHours;
      const last = Number(this.repo.getMeta('lastBackupAt') ?? 0);
      if (hours > 0 && Date.now() - last >= hours * 3600_000) {
        try {
          this.backupNow();
        } catch (err) {
          this.errors.record('backup', err);
        }
      }
    };
    check();
    this.timer = setInterval(check, 10 * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  backupNow(): { file: string; sizeMb: number } {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const file = path.join(this.dir, `soldesk-${stamp}.db`);
    if (fs.existsSync(file)) fs.rmSync(file);
    this.db.backupTo(file);
    this.repo.setMeta('lastBackupAt', String(Date.now()));
    this.prune();
    const sizeMb = fs.statSync(file).size / 1048576;
    logger.info({ file, sizeMb }, 'kopia zapasowa bazy utworzona');
    return { file: path.basename(file), sizeMb };
  }

  list(): { file: string; sizeMb: number; createdAt: number }[] {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const st = fs.statSync(path.join(this.dir, f));
        return { file: f, sizeMb: st.size / 1048576, createdAt: st.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private prune(): void {
    const keep = this.settings.get().system.backupKeep;
    for (const old of this.list().slice(keep)) fs.rmSync(path.join(this.dir, old.file));
  }
}
