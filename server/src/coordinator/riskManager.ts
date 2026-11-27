import type { Position, SessionRecord, SessionStats } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import type { Repository } from '../db/repository.ts';
import type { ChainRegistry } from '../chains/chainRegistry.ts';

export type RiskResult = { ok: true; valueSol: number } | { ok: false; reason: string };

/** Limity ryzyka egzekwowane przed każdym zakupem oraz w sposób ciągły. */
export class RiskManager {
  private settings: SettingsService;
  private repo: Repository;
  private chains: ChainRegistry;

  constructor(settings: SettingsService, repo: Repository, chains: ChainRegistry) {
    this.settings = settings;
    this.repo = repo;
    this.chains = chains;
  }

  /** Ciągłe limity sesji. Zwraca powód naruszenia albo null. */
  checkLimits(stats: SessionStats): string | null {
    const r = this.settings.get().risk;
    if (r.maxSessionLossUsd > 0 && stats.totalPnl.usd <= -r.maxSessionLossUsd) {
      return `strata sesji ${stats.totalPnl.usd.toFixed(2)} USD przekroczyła limit ${r.maxSessionLossUsd} USD`;
    }
    if (r.maxSessionLossPct > 0 && stats.pnlPct <= -r.maxSessionLossPct) {
      return `strata sesji ${stats.pnlPct.toFixed(1)}% przekroczyła limit ${r.maxSessionLossPct}%`;
    }
    if (r.maxCostsUsd > 0 && stats.totalCosts.usd >= r.maxCostsUsd) {
      return `koszty ${stats.totalCosts.usd.toFixed(2)} USD osiągnęły limit ${r.maxCostsUsd} USD`;
    }
    return null;
  }

  checkBuy(p: {
    session: SessionRecord;
    usd: number;
    solUsd: number;
    stats: SessionStats;
    openPositions: Position[];
    balanceSol: number | null;
    manual: boolean;
  }): RiskResult {
    const { trading: t, risk: r } = this.settings.get();
    const allowedStatus = p.manual ? ['running', 'paused'] : ['running'];
    if (!allowedStatus.includes(p.session.status)) return { ok: false, reason: `sesja w stanie ${p.session.status}` };
    if (!(p.solUsd > 0)) return { ok: false, reason: 'brak kursu waluty natywnej w USD' };
    if (p.usd < t.minTradeUsd) return { ok: false, reason: `kwota poniżej minimum ${t.minTradeUsd} USD` };
    if (p.usd > t.maxTradeUsd) return { ok: false, reason: `kwota powyżej maksimum ${t.maxTradeUsd} USD` };
    if (p.openPositions.length >= t.maxOpenPositions) return { ok: false, reason: 'limit otwartych pozycji' };

    const breach = this.checkLimits(p.stats);
    if (breach) return { ok: false, reason: breach };

    if (this.repo.countTrades(p.session.id) >= r.maxTradesPerSession) return { ok: false, reason: 'limit transakcji w sesji' };
    if (this.repo.countTrades(p.session.id, Date.now() - 3600_000) >= r.maxTradesPerHour) {
      return { ok: false, reason: 'limit transakcji na godzinę' };
    }

    const deployedUsd = p.openPositions.reduce((a, x) => a + x.costSol, 0) * p.solUsd;
    if (deployedUsd + p.usd > r.maxDeployedUsd + 1e-9) {
      return { ok: false, reason: `limit kapitału w pozycjach (${r.maxDeployedUsd} USD)` };
    }
    const equityUsd = p.stats.currentCapital.usd;
    if (equityUsd > 0 && ((deployedUsd + p.usd) / equityUsd) * 100 > r.maxDeployedPctOfEquity + 1e-9) {
      return { ok: false, reason: `limit ${r.maxDeployedPctOfEquity}% kapitału w pozycjach` };
    }

    const valueSol = p.usd / p.solUsd;
    if (p.balanceSol === null) return { ok: false, reason: 'nieznane saldo portfela' };
    const chain = p.session.chain;
    const sym = p.session.nativeSymbol;
    const required = valueSol + this.chains.networkFeeEstimate(chain) + this.chains.firstBuyRent(p.session) + this.chains.gasReserve(chain);
    if (required > p.balanceSol + 1e-12) {
      return {
        ok: false,
        reason: `niewystarczające saldo: potrzeba ${required.toFixed(6)} ${sym} (z opłatami i rezerwą), dostępne ${p.balanceSol.toFixed(6)} ${sym}`,
      };
    }
    return { ok: true, valueSol };
  }
}
