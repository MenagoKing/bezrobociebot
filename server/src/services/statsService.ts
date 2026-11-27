import type { Money, Position, SessionRecord, SessionStats } from '../../../shared/types.ts';
import type { Repository } from '../db/repository.ts';
import type { MarketService } from '../market/marketService.ts';

/** Statystyki finansowe sesji — zawsze w SOL i USD. */
export class StatsService {
  private repo: Repository;
  private market: MarketService;

  constructor(repo: Repository, market: MarketService) {
    this.repo = repo;
    this.market = market;
  }

  compute(session: SessionRecord, opts: { balanceSol?: number | null; priceSol?: number; solUsd?: number } = {}): SessionStats {
    const positions = this.repo.listPositions(session.id);
    const trades = this.repo.listTrades({ sessionId: session.id, limit: 1_000_000 });
    const solUsd = opts.solUsd ?? this.market.solUsdNow();
    const lastTradePrice = trades[0]?.priceSol ?? 0;
    const priceSol =
      opts.priceSol ?? (this.market.token?.address === session.tokenAddress ? this.market.snapshot?.priceSol : undefined) ?? lastTradePrice;
    const m = (sol: number): Money => ({ sol, usd: sol * solUsd });

    const open = positions.filter((p) => p.status === 'open');
    const closed = positions.filter((p) => p.status === 'closed');
    const positionsValueSol = open.reduce((a, p) => a + p.amount * priceSol, 0);
    const balanceSol = opts.balanceSol ?? (session.mode === 'paper' ? session.paperBalanceSol : session.startCapitalSol);
    const currentSol = balanceSol + positionsValueSol;
    const realizedSol = closed.reduce((a, p) => a + (p.realizedPnlSol ?? 0), 0);
    const realizedUsd = closed.reduce((a, p) => a + (p.realizedPnlUsd ?? 0), 0);
    const unrealizedSol = open.reduce((a, p) => a + (p.amount * priceSol - p.costSol), 0);
    const platformFeesSol = trades.reduce((a, t) => a + t.feeSol, 0);
    const networkFeesSol = trades.reduce((a, t) => a + t.networkFeeSol, 0);
    const volumeSol = trades.reduce((a, t) => a + t.valueSol, 0);
    const end = session.endedAt ?? Date.now();
    const totalPnlSol = currentSol - session.startCapitalSol;

    return {
      sessionId: session.id,
      startCapital: { sol: session.startCapitalSol, usd: session.startCapitalUsd },
      currentCapital: m(currentSol),
      balance: m(balanceSol),
      positionsValue: m(positionsValueSol),
      realizedPnl: { sol: realizedSol, usd: realizedUsd },
      unrealizedPnl: m(unrealizedSol),
      totalPnl: { sol: totalPnlSol, usd: currentSol * solUsd - session.startCapitalUsd },
      pnlPct: session.startCapitalSol > 0 ? (totalPnlSol / session.startCapitalSol) * 100 : 0,
      platformFees: m(platformFeesSol),
      networkFees: m(networkFeesSol),
      rent: m(session.rentPaidSol),
      totalCosts: m(platformFeesSol + networkFeesSol + session.rentPaidSol),
      buys: trades.filter((t) => t.side === 'buy').length,
      sells: trades.filter((t) => t.side === 'sell').length,
      wins: closed.filter((p) => (p.realizedPnlSol ?? 0) >= 0).length,
      losses: closed.filter((p) => (p.realizedPnlSol ?? 0) < 0).length,
      totalVolume: m(volumeSol),
      avgTrade: m(trades.length ? volumeSol / trades.length : 0),
      openPositions: open.length,
      durationSec: Math.max(0, Math.round((end - session.startedAt) / 1000)),
      solUsd,
      nativeSymbol: session.nativeSymbol,
    };
  }

  /** Pozycje z bieżącą wyceną (do tabel w panelu). */
  withMarks(positions: Position[], priceSol: number | undefined, solUsd: number): Position[] {
    if (!priceSol) return positions;
    return positions.map((p) => {
      if (p.status !== 'open') return p;
      const value = p.amount * priceSol;
      const pnl = value - p.costSol;
      return {
        ...p,
        markPriceSol: priceSol,
        unrealizedPnlSol: pnl,
        unrealizedPnlUsd: pnl * solUsd,
        unrealizedPnlPct: p.costSol > 0 ? (pnl / p.costSol) * 100 : 0,
      };
    });
  }
}
