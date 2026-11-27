import type { MarketAnalysis, MarketSnapshot, Position, TradingConfig } from '../../../shared/types.ts';
import { round } from '../core/util.ts';

export type EntryDecision = { action: 'buy'; usd: number; reason: string } | { action: 'skip'; reason: string };

/**
 * Strategia wejścia: kupno tylko w dozwolonym scenariuszu, z wystarczającą pewnością,
 * płynnością, po upływie cooldownu i w limicie liczby pozycji. Kwota losowa lub stała.
 */
export function evaluateEntry(ctx: {
  analysis: MarketAnalysis | null;
  snapshot: MarketSnapshot | null;
  openPositions: Position[];
  lastBuyAt: number | null;
  now: number;
  cfg: TradingConfig;
  rng?: () => number;
}): EntryDecision {
  const { analysis, snapshot, cfg, now } = ctx;
  if (!analysis || !snapshot) return { action: 'skip', reason: 'brak danych rynkowych' };
  if (analysis.insufficientData) return { action: 'skip', reason: analysis.reasons[0] ?? 'za mało danych' };
  if (ctx.openPositions.length >= cfg.maxOpenPositions) return { action: 'skip', reason: 'limit otwartych pozycji' };
  if (ctx.lastBuyAt && now - ctx.lastBuyAt < cfg.buyCooldownSeconds * 1000) {
    const left = Math.ceil((cfg.buyCooldownSeconds * 1000 - (now - ctx.lastBuyAt)) / 1000);
    return { action: 'skip', reason: `cooldown (${left} s)` };
  }
  if (snapshot.liquidityUsd < cfg.minLiquidityUsd) return { action: 'skip', reason: 'płynność poniżej minimum' };
  if (!cfg.entryScenarios.includes(analysis.scenario)) {
    return { action: 'skip', reason: `scenariusz ${analysis.scenario} poza listą wejść` };
  }
  if (analysis.confidence < cfg.minConfidence) return { action: 'skip', reason: 'zbyt niska pewność klasyfikacji' };
  const rng = ctx.rng ?? Math.random;
  const usd =
    cfg.tradeSizing === 'fixed'
      ? cfg.fixedTradeUsd
      : round(cfg.minTradeUsd + rng() * (cfg.maxTradeUsd - cfg.minTradeUsd), 2);
  return { action: 'buy', usd: Math.min(cfg.maxTradeUsd, Math.max(cfg.minTradeUsd, usd)), reason: `strategy:entry:${analysis.scenario}` };
}

/** Wynik pozycji względem kosztu (z opłatami) przy danej cenie rynkowej. */
export function positionPnlPct(position: Position, priceSol: number): number {
  if (position.costSol <= 0) return 0;
  return ((position.amount * priceSol) / position.costSol - 1) * 100;
}

/**
 * Strategia wyjścia. Twardy stop-loss działa zawsze; pozostałe reguły dopiero
 * po minimalnym czasie utrzymywania pozycji.
 */
export function evaluateExit(ctx: {
  position: Position;
  priceSol: number;
  analysis: MarketAnalysis | null;
  now: number;
  cfg: TradingConfig;
}): string | null {
  const { position, priceSol, cfg, analysis } = ctx;
  const pnl = positionPnlPct(position, priceSol);
  const heldSec = (ctx.now - position.openedAt) / 1000;
  if (cfg.hardStopLossPct > 0 && pnl <= -cfg.hardStopLossPct) return 'strategy:exit:hard_stop_loss';
  if (heldSec < cfg.minHoldSeconds) return null;
  if (cfg.takeProfitPct > 0 && pnl >= cfg.takeProfitPct) return 'strategy:exit:take_profit';
  if (cfg.stopLossPct > 0 && pnl <= -cfg.stopLossPct) return 'strategy:exit:stop_loss';
  if (
    cfg.trailingStopPct > 0 &&
    position.peakPriceSol > position.entryPriceSol &&
    priceSol <= position.peakPriceSol * (1 - cfg.trailingStopPct / 100)
  ) {
    return 'strategy:exit:trailing_stop';
  }
  if (cfg.maxHoldSeconds > 0 && heldSec >= cfg.maxHoldSeconds) return 'strategy:exit:max_hold_time';
  if (analysis && !analysis.insufficientData && cfg.exitOnScenarios.includes(analysis.scenario)) {
    return `strategy:exit:scenario_${analysis.scenario}`;
  }
  return null;
}
