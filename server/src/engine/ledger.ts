import type { Order, Position, SessionRecord, Trade } from '../../../shared/types.ts';
import type { Repository } from '../db/repository.ts';
import type { Fill } from '../execution/executor.ts';

export interface LedgerResult {
  trade: Trade;
  position: Position;
  session: SessionRecord;
  order: Order;
}

/**
 * Księgowanie wykonanych zleceń — atomowo (jedna transakcja SQLite):
 * transakcja, pozycja, saldo symulacyjne, rent i status zlecenia.
 */
export class Ledger {
  private repo: Repository;
  constructor(repo: Repository) {
    this.repo = repo;
  }

  applyBuy(session: SessionRecord, order: Order, fill: Fill, solUsd: number): LedgerResult {
    return this.repo.db.tx(() => {
      const now = Date.now();
      const position = this.repo.createPosition({
        sessionId: session.id,
        walletId: order.walletId,
        openedAt: now,
        amount: fill.amount,
        decimals: fill.decimals,
        entryPriceSol: fill.priceSol,
        entryPriceUsd: fill.priceSol * solUsd,
        costSol: fill.valueSol + fill.networkFeeSol,
        peakPriceSol: fill.marketPriceSol,
        feesSol: fill.feeSol + fill.networkFeeSol,
      });
      const trade = this.repo.insertTrade({
        sessionId: session.id,
        positionId: position.id,
        side: 'buy',
        ts: now,
        priceSol: fill.priceSol,
        priceUsd: fill.priceSol * solUsd,
        amount: fill.amount,
        valueSol: fill.valueSol,
        valueUsd: fill.valueSol * solUsd,
        feeSol: fill.feeSol,
        networkFeeSol: fill.networkFeeSol,
        solUsd,
        txSignature: fill.txSignature,
        mode: session.mode,
        reason: order.reason,
      });
      const updated = this.repo.updateSession(session.id, {
        paperBalanceSol:
          session.mode === 'paper'
            ? session.paperBalanceSol - fill.valueSol - fill.networkFeeSol - fill.rentSol
            : session.paperBalanceSol,
        rentPaidSol: session.rentPaidSol + fill.rentSol,
      });
      const filled = this.repo.updateOrder(order.id, { status: 'filled', tradeId: trade.id, error: null });
      return { trade, position, session: updated, order: filled };
    });
  }

  applySell(session: SessionRecord, order: Order, position: Position, fill: Fill, solUsd: number): LedgerResult {
    return this.repo.db.tx(() => {
      const now = Date.now();
      const proceeds = fill.valueSol - fill.networkFeeSol;
      const pnl = proceeds - position.costSol;
      const closed = this.repo.updatePosition(position.id, {
        status: 'closed',
        closedAt: now,
        exitPriceSol: fill.priceSol,
        exitPriceUsd: fill.priceSol * solUsd,
        proceedsSol: proceeds,
        realizedPnlSol: pnl,
        realizedPnlUsd: pnl * solUsd,
        feesSol: position.feesSol + fill.feeSol + fill.networkFeeSol,
        exitReason: order.reason,
      });
      const trade = this.repo.insertTrade({
        sessionId: session.id,
        positionId: position.id,
        side: 'sell',
        ts: now,
        priceSol: fill.priceSol,
        priceUsd: fill.priceSol * solUsd,
        amount: fill.amount,
        valueSol: fill.valueSol,
        valueUsd: fill.valueSol * solUsd,
        feeSol: fill.feeSol,
        networkFeeSol: fill.networkFeeSol,
        solUsd,
        txSignature: fill.txSignature,
        mode: session.mode,
        reason: order.reason,
      });
      const updated = this.repo.updateSession(session.id, {
        paperBalanceSol: session.mode === 'paper' ? session.paperBalanceSol + proceeds : session.paperBalanceSol,
      });
      const filled = this.repo.updateOrder(order.id, { status: 'filled', tradeId: trade.id, error: null });
      return { trade, position: closed, session: updated, order: filled };
    });
  }
}
