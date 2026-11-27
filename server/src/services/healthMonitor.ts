import fs from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { HealthInfo } from '../../../shared/types.ts';
import type { EventBus } from '../core/eventBus.ts';
import type { Repository } from '../db/repository.ts';
import type { MarketService } from '../market/marketService.ts';

/** Monitoring procesu: CPU, pamięć, opóźnienie pętli zdarzeń, kolejka, feed, błędy. */
export class HealthMonitor {
  current: HealthInfo | null = null;
  sseClients = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastCpu = process.cpuUsage();
  private lastAt = process.hrtime.bigint();
  private loop = monitorEventLoopDelay({ resolution: 20 });

  private bus: EventBus;
  private repo: Repository;
  private market: MarketService;
  private dbFile: string;

  constructor(bus: EventBus, repo: Repository, market: MarketService, dbFile: string) {
    this.bus = bus;
    this.repo = repo;
    this.market = market;
    this.dbFile = dbFile;
  }

  start(intervalMs = 5000): void {
    this.loop.enable();
    this.sample();
    this.timer = setInterval(() => this.sample(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.loop.disable();
  }

  private sample(): void {
    const now = process.hrtime.bigint();
    const elapsedUs = Number(now - this.lastAt) / 1000;
    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;
    const mem = process.memoryUsage();
    let dbSize = 0;
    for (const suffix of ['', '-wal']) {
      try {
        dbSize += fs.statSync(this.dbFile + suffix).size;
      } catch {
        // plik WAL może nie istnieć
      }
    }
    const lastBackup = this.repo.getMeta('lastBackupAt');
    this.current = {
      ts: Date.now(),
      uptimeSec: Math.round(process.uptime()),
      cpuPct: elapsedUs > 0 ? ((cpu.user + cpu.system) / elapsedUs) * 100 : 0,
      rssMb: mem.rss / 1048576,
      heapUsedMb: mem.heapUsed / 1048576,
      systemMemUsedPct: (1 - os.freemem() / os.totalmem()) * 100,
      loadAvg: os.loadavg(),
      // histogram mierzy odstęp między próbkami, więc odejmujemy rozdzielczość (20 ms)
      eventLoopLagMs: Math.max(0, this.loop.mean / 1e6 - 20),
      sseClients: this.sseClients,
      queueLength: this.repo.countActiveOrders(),
      dbSizeMb: dbSize / 1048576,
      feed: this.market.feed,
      unacknowledgedErrors: this.repo.countUnacknowledgedErrors(),
      lastBackupAt: lastBackup ? Number(lastBackup) : null,
    };
    this.loop.reset();
    this.bus.emit('system.health', this.current);
  }
}
