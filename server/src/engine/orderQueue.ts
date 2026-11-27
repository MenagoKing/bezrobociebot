import type { Order, OrderSide, SessionRecord } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import type { EventBus } from '../core/eventBus.ts';
import { RetryableError, errorMessage, sleep } from '../core/util.ts';
import type { Repository } from '../db/repository.ts';
import type { Executor, Fill } from '../execution/executor.ts';
import type { MarketService } from '../market/marketService.ts';
import type { Ledger, LedgerResult } from './ledger.ts';

const EXECUTABLE_SESSION = new Set(['running', 'paused', 'stopping']);

export interface OrderQueueDeps {
  repo: Repository;
  bus: EventBus;
  errors: ErrorMonitor;
  settings: SettingsService;
  ledger: Ledger;
  market: MarketService;
  getExecutor: (session: SessionRecord) => Executor;
}

/**
 * Trwała kolejka zleceń: zapis w bazie, wykonanie szeregowe (jeden portfel → brak wyścigów sald),
 * ponawianie z wykładniczym odstępem, priorytety (likwidacja awaryjna przed resztą).
 */
export class OrderQueue {
  private processing = false;
  private wakeTimer: NodeJS.Timeout | null = null;
  private d: OrderQueueDeps;

  constructor(deps: OrderQueueDeps) {
    this.d = deps;
  }

  enqueue(o: { sessionId: number; side: OrderSide; valueSol?: number | null; positionId?: number | null; reason: string; priority?: number }): Order {
    if (o.side === 'sell' && o.positionId) {
      const dup = this.d.repo
        .listOrders({ sessionId: o.sessionId, statuses: ['pending', 'executing'] })
        .find((x) => x.side === 'sell' && x.positionId === o.positionId);
      if (dup) return dup;
    }
    const order = this.d.repo.createOrder({
      sessionId: o.sessionId,
      side: o.side,
      valueSol: o.valueSol ?? null,
      positionId: o.positionId ?? null,
      reason: o.reason,
      priority: o.priority,
    });
    this.d.bus.emit('order.updated', order);
    this.kick();
    return order;
  }

  hasActive(sessionId: number): boolean {
    return this.d.repo.listOrders({ sessionId, statuses: ['pending', 'executing'], limit: 1 }).length > 0;
  }

  activeOrders(sessionId: number): Order[] {
    return this.d.repo.listOrders({ sessionId, statuses: ['pending', 'executing'] });
  }

  kick(): void {
    if (!this.processing) setImmediate(() => void this.process());
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    try {
      for (;;) {
        const next = this.d.repo.nextPendingOrder(Date.now());
        if (!next) break;
        await this.execute(next);
      }
    } catch (err) {
      this.d.errors.record('orders.loop', err);
    } finally {
      this.processing = false;
      const at = this.d.repo.nextPendingAttemptAt();
      if (at !== null) this.wakeTimer = setTimeout(() => void this.process(), Math.max(50, at - Date.now()));
    }
  }

  private cancel(order: Order, reason: string): void {
    this.d.bus.emit('order.updated', this.d.repo.updateOrder(order.id, { status: 'cancelled', error: reason }));
  }

  private publish(result: LedgerResult): void {
    const { bus, repo } = this.d;
    bus.emit('order.updated', result.order);
    bus.emit('position.updated', result.position);
    bus.emit('trade.executed', { trade: result.trade, position: result.position, session: result.session });
    bus.emit('session.updated', { session: result.session, token: repo.getSessionToken(result.session.id) });
  }

  private apply(order: Order, fill: Fill): LedgerResult {
    const { repo, ledger, market } = this.d;
    const session = repo.getSession(order.sessionId)!;
    const solUsd = market.solUsdNow();
    if (order.side === 'buy') return ledger.applyBuy(session, order, fill, solUsd);
    return ledger.applySell(session, order, repo.getPosition(order.positionId!)!, fill, solUsd);
  }

  private async execute(pending: Order): Promise<void> {
    const { repo, bus, errors, settings, getExecutor } = this.d;
    const session = repo.getSession(pending.sessionId);
    const token = session ? repo.getSessionToken(session.id) : null;
    if (!session || !token || !EXECUTABLE_SESSION.has(session.status)) {
      this.cancel(pending, 'sesja nieaktywna');
      return;
    }
    const position = pending.positionId ? repo.getPosition(pending.positionId) : null;
    if (pending.side === 'sell' && (!position || position.status !== 'open')) {
      this.cancel(pending, 'pozycja już zamknięta');
      return;
    }
    let order = repo.updateOrder(pending.id, { status: 'executing', attempts: pending.attempts + 1 });
    bus.emit('order.updated', order);
    const executor = getExecutor(session);
    const hooks = {
      onSubmitted: (sig: string) => {
        order = repo.updateOrder(order.id, { txSignature: sig });
        bus.emit('order.updated', order);
      },
    };
    try {
      const ctx = { session, token };
      let fill: Fill;
      if (order.side === 'buy') {
        if (!order.valueSol || order.valueSol <= 0) throw new Error('Brak kwoty zlecenia kupna');
        fill = await executor.buy(ctx, order.valueSol, hooks);
      } else {
        const isLast = repo.listOpenPositions(session.id).length === 1;
        fill = await executor.sell(ctx, position!, isLast, hooks);
      }
      this.publish(this.apply(order, fill));
    } catch (err) {
      const retryable = err instanceof RetryableError;
      const max = settings.get().risk.maxOrderRetries;
      const message = errorMessage(err);
      if (retryable && order.attempts < max) {
        order = repo.updateOrder(order.id, {
          status: 'pending',
          error: message,
          nextAttemptAt: Date.now() + 1000 * 2 ** order.attempts,
        });
        errors.record('orders', err, { level: 'warn', context: { orderId: order.id, side: order.side, attempt: order.attempts } });
      } else {
        order = repo.updateOrder(order.id, { status: 'failed', error: message });
        errors.record('orders', err, { context: { orderId: order.id, side: order.side, attempts: order.attempts } });
      }
      bus.emit('order.updated', order);
    }
  }

  /** Anuluje oczekujące zlecenia sesji (np. przy awaryjnym zatrzymaniu). */
  cancelPending(sessionId: number, reason: string, side?: OrderSide): number {
    const pending = this.d.repo
      .listOrders({ sessionId, statuses: ['pending'], limit: 1000 })
      .filter((o) => !side || o.side === side);
    for (const o of pending) this.cancel(o, reason);
    return pending.length;
  }

  /** Czeka aż kolejka sesji się opróżni (lub upłynie limit czasu). */
  async drain(sessionId: number, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!this.hasActive(sessionId)) return true;
      await sleep(250);
    }
    return !this.hasActive(sessionId);
  }

  /** Po restarcie: zlecenia przerwane w trakcie wykonania — uzgodnienie z siecią lub oznaczenie jako nieudane. */
  async recover(): Promise<void> {
    const { repo, errors, getExecutor, bus } = this.d;
    for (const order of repo.listOrders({ statuses: ['executing'], limit: 1000 })) {
      const session = repo.getSession(order.sessionId);
      const token = session ? repo.getSessionToken(session.id) : null;
      try {
        const fill = session && token ? await getExecutor(session).reconcile({ session, token }, order) : null;
        if (fill) {
          this.publish(this.apply(order, fill));
          errors.record('orders.recovery', `Zlecenie #${order.id} zostało wykonane przed restartem — zaksięgowano`, { level: 'warn' });
        } else {
          bus.emit('order.updated', repo.updateOrder(order.id, { status: 'failed', error: 'przerwane restartem (nie wykonane)' }));
        }
      } catch (err) {
        repo.updateOrder(order.id, { status: 'failed', error: `uzgodnienie nieudane: ${errorMessage(err)}` });
        errors.record('orders.recovery', err, { context: { orderId: order.id, tx: order.txSignature } });
      }
    }
    this.kick();
  }
}
