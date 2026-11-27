import type { BotSnapshot, BotState, Order, SessionRecord } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import type { RiskManager, WalletBalance } from '../coordinator/riskManager.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import type { EventBus } from '../core/eventBus.ts';
import { logger } from '../core/logger.ts';
import { errorMessage } from '../core/util.ts';
import type { Repository } from '../db/repository.ts';
import type { MarketService } from '../market/marketService.ts';
import type { StatsService } from '../services/statsService.ts';
import type { OrderQueue } from './orderQueue.ts';
import { StateMachine } from './stateMachine.ts';
import { evaluateEntry, evaluateExit, positionPnlPct } from './strategy.ts';

export interface EngineDeps {
  bus: EventBus;
  repo: Repository;
  settings: SettingsService;
  market: MarketService;
  queue: OrderQueue;
  risk: RiskManager;
  stats: StatsService;
  errors: ErrorMonitor;
  getBalanceSol: (session: SessionRecord) => number | null;
  /** Portfele, z których można kupić w tej sesji, z saldami. */
  getWallets: (session: SessionRecord) => WalletBalance[];
}

/**
 * Silnik bota: cykliczna ocena rynku → decyzje strategii → zlecenia do kolejki.
 * Stan widoczny w panelu wynika z maszyny stanów, a „stan spoczynkowy” (WATCHING/HOLDING/PAUSED)
 * jest wyliczany z faktów: zlecenia w kolejce, otwarte pozycje, flaga pauzy.
 */
export class BotEngine {
  private sm: StateMachine;
  private d: EngineDeps;
  private sessionId: number | null = null;
  private paused = false;
  private timer: NodeJS.Timeout | null = null;
  private errorUntil = 0;
  private lastBuyAt: number | null = null;
  private lastAction: string | null = null;
  private lastError: string | null = null;
  private lastSignal: string | null = null;
  private watchingSince: number | null = null;
  private lastEvaluationAt: number | null = null;

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.sm = new StateMachine((from, to, reason) => {
      logger.info({ from, to, reason }, 'bot: zmiana stanu');
      this.publish();
    });
    deps.bus.on('order.updated', (o) => this.onOrder(o));
  }

  snapshot(): BotSnapshot {
    return {
      state: this.sm.state,
      since: this.sm.since,
      previous: this.sm.previous,
      lastAction: this.lastAction,
      lastError: this.lastError,
      watchingSince: this.watchingSince,
      lastEvaluationAt: this.lastEvaluationAt,
      lastSignal: this.lastSignal,
    };
  }

  get state(): BotState {
    return this.sm.state;
  }

  private publish(): void {
    this.d.bus.emit('bot.state', this.snapshot());
  }

  private setSignal(signal: string): void {
    if (signal === this.lastSignal) return;
    this.lastSignal = signal;
    this.publish();
  }

  private go(to: BotState, reason: string): void {
    try {
      this.sm.transition(to, reason);
    } catch (err) {
      this.d.errors.record('engine.state', err, { level: 'warn' });
    }
  }

  boot(): void {
    this.go('IDLE', 'start silnika');
  }

  attach(sessionId: number, opts: { paused: boolean }): void {
    this.sessionId = sessionId;
    this.paused = opts.paused;
    this.errorUntil = 0;
    this.lastError = null;
    this.watchingSince = Date.now();
    this.lastBuyAt = this.d.repo.listTrades({ sessionId, limit: 50 }).find((t) => t.side === 'buy')?.ts ?? null;
    this.settle('start sesji');
    this.schedule();
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sessionId = null;
    this.paused = false;
    this.watchingSince = null;
    this.lastSignal = null;
    this.go('IDLE', 'koniec sesji');
  }

  pause(reason: string): void {
    this.paused = true;
    this.setSignal(`wstrzymano: ${reason}`);
    this.settle(reason);
  }

  resume(): void {
    this.paused = false;
    this.errorUntil = 0;
    this.settle('wznowienie');
  }

  shutdown(): void {
    if (this.sessionId !== null) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.sessionId = null;
      this.go('IDLE', 'zamykanie aplikacji');
    }
    this.go('OFFLINE', 'zamykanie aplikacji');
  }

  private enterError(message: string): void {
    this.lastError = message;
    this.errorUntil = Date.now() + this.d.settings.get().risk.errorRecoverySeconds * 1000;
    if (this.sm.state !== 'IDLE' && this.sm.state !== 'OFFLINE') this.go('ERROR', message);
    else this.publish();
  }

  /** Ustala stan na podstawie faktów (kolejka, pozycje, pauza, okno błędu). */
  private settle(reason: string): void {
    const sid = this.sessionId;
    if (sid === null) return this.go('IDLE', reason);
    const active = this.d.queue.activeOrders(sid);
    const executing = active.find((o) => o.status === 'executing');
    if (executing) return this.go(executing.side === 'buy' ? 'BUYING' : 'SELLING', reason);
    if (active.length) return this.go('AWAITING_TASK', reason);
    if (this.sm.state === 'ERROR' && Date.now() < this.errorUntil) return;
    if (this.paused) return this.go('PAUSED', reason);
    const open = this.d.repo.listOpenPositions(sid).length;
    this.go(open > 0 ? 'HOLDING' : 'WATCHING', reason);
  }

  private onOrder(order: Order): void {
    if (order.sessionId !== this.sessionId) return;
    if (order.status === 'filled') {
      this.lastAction = `${order.side === 'buy' ? 'Kupno' : 'Sprzedaż'} #${order.id} (${order.reason})`;
      if (order.side === 'buy') this.lastBuyAt = Date.now();
      this.errorUntil = 0;
      if (this.sm.state === 'ERROR') this.lastError = null;
    }
    if (order.status === 'failed') {
      this.enterError(`Zlecenie #${order.id} nieudane: ${order.error ?? 'nieznany błąd'}`);
      return this.settle(`zlecenie #${order.id}: failed`);
    }
    this.settle(`zlecenie #${order.id}: ${order.status}`);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.sessionId === null) return;
    const ms = this.d.settings.get().trading.evaluationIntervalSeconds * 1000;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    try {
      this.evaluate();
    } catch (err) {
      this.d.errors.record('engine', err);
      this.enterError(errorMessage(err));
    } finally {
      this.schedule();
    }
  }

  /** Jeden cykl decyzyjny. */
  evaluate(): void {
    const sid = this.sessionId;
    if (sid === null) return;
    const { repo, market, queue, settings, risk, stats, bus } = this.d;
    const session = repo.getSession(sid);
    if (!session || !['running', 'paused'].includes(session.status)) return;
    const cfg = settings.get();
    const now = Date.now();
    this.lastEvaluationAt = now;

    const snapshot = market.snapshot;
    const analysis = market.analysis;
    const fresh = market.isFresh(cfg.risk.maxDataAgeSeconds);
    const open = repo.listOpenPositions(sid);

    // aktualizacja szczytów cen (trailing stop)
    if (fresh && snapshot) {
      for (const p of open) {
        if (snapshot.priceSol > p.peakPriceSol) {
          p.peakPriceSol = snapshot.priceSol;
          repo.updatePosition(p.id, { peakPriceSol: snapshot.priceSol });
        }
      }
    }

    if (this.sm.state === 'ERROR') {
      if (now < this.errorUntil) return;
      this.settle('automatyczne wznowienie po błędzie');
    }
    if (queue.hasActive(sid)) return;
    if (!fresh || !snapshot) return this.setSignal('dane rynkowe nieaktualne — decyzje wstrzymane');

    const price = snapshot.priceSol;
    if (this.paused || session.status === 'paused') {
      if (cfg.risk.pauseKeepsHardStop && cfg.trading.hardStopLossPct > 0) {
        for (const p of open) {
          if (positionPnlPct(p, price) <= -cfg.trading.hardStopLossPct) {
            queue.enqueue({ sessionId: sid, side: 'sell', positionId: p.id, reason: 'risk:hard_stop_during_pause', priority: 5 });
          }
        }
      }
      return;
    }

    const balanceSol = this.d.getBalanceSol(session);
    const st = stats.compute(session, { balanceSol, priceSol: price, solUsd: snapshot.solUsd });
    const breach = risk.checkLimits(st);
    if (breach) {
      this.setSignal(`limit ryzyka: ${breach}`);
      bus.emit('risk.breach', { reason: breach, action: cfg.risk.onLimitBreach });
      return;
    }

    let exits = 0;
    for (const p of open) {
      const reason = evaluateExit({ position: p, priceSol: price, analysis, now, cfg: cfg.trading });
      if (reason) {
        queue.enqueue({ sessionId: sid, side: 'sell', positionId: p.id, reason });
        exits++;
      }
    }
    if (exits) return this.setSignal(`wyjście z ${exits} poz.`);

    const decision = evaluateEntry({ analysis, snapshot, openPositions: open, lastBuyAt: this.lastBuyAt, now, cfg: cfg.trading });
    if (decision.action === 'skip') return this.setSignal(decision.reason);

    const check = risk.checkBuyOnWallets({
      session,
      usd: decision.usd,
      solUsd: snapshot.solUsd,
      stats: st,
      openPositions: open,
      wallets: this.d.getWallets(session),
      manual: false,
    });
    if (!check.ok) return this.setSignal(`ryzyko: ${check.reason}`);

    this.lastBuyAt = now;
    queue.enqueue({ sessionId: sid, side: 'buy', walletId: check.walletId, valueSol: check.valueSol, reason: decision.reason });
    const where = check.walletId ? ` z portfela #${check.walletId}` : '';
    this.setSignal(`sygnał kupna ${decision.usd.toFixed(2)} USD${where} (${analysis?.scenario})`);
  }
}
