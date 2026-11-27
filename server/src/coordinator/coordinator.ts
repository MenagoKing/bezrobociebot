import type { DataSource, ExecutionMode, Order, SessionRecord, SessionStats, SessionStatus } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import { env } from '../config/env.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import type { EventBus } from '../core/eventBus.ts';
import { logger } from '../core/logger.ts';
import { UserError, errorMessage } from '../core/util.ts';
import type { Repository } from '../db/repository.ts';
import type { BotEngine } from '../engine/botEngine.ts';
import type { OrderQueue } from '../engine/orderQueue.ts';
import type { MarketService } from '../market/marketService.ts';
import type { SolanaRpc } from '../solana/rpc.ts';
import type { EvmClients } from '../evm/evmClients.ts';
import type { ChainRegistry } from '../chains/chainRegistry.ts';
import type { Hex } from 'viem';
import type { AccountService } from '../services/accountService.ts';
import type { StatsService } from '../services/statsService.ts';
import type { WalletMonitor } from '../services/walletMonitor.ts';
import type { RiskManager } from './riskManager.ts';

export const LIVE_CONFIRM_PHRASE = 'HANDEL LIVE';

export interface CoordinatorDeps {
  bus: EventBus;
  repo: Repository;
  settings: SettingsService;
  market: MarketService;
  queue: OrderQueue;
  risk: RiskManager;
  engine: BotEngine;
  stats: StatsService;
  errors: ErrorMonitor;
  wallet: WalletMonitor;
  account: AccountService;
  rpc: SolanaRpc;
  chains: ChainRegistry;
  evmClients: EvmClients;
}

/**
 * Nadrzędny koordynator: cykl życia sesji, egzekwowanie konfiguracji i limitów ryzyka,
 * polecenia autoryzowane (ręczne), awaryjne zatrzymanie, odzyskiwanie po restarcie,
 * migawki kapitału i publikacja statystyk.
 */
export class Coordinator {
  private d: CoordinatorDeps;
  private equityTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(deps: CoordinatorDeps) {
    this.d = deps;
  }

  async init(): Promise<void> {
    const { engine, queue, repo, settings, market, bus, errors } = this.d;
    engine.boot();
    await queue.recover();
    bus.on('risk.breach', (b) => this.onRiskBreach(b.reason, b.action));
    bus.on('trade.executed', ({ session }) => {
      this.emitStats();
      if (session.mode === 'live') void this.d.wallet.refresh();
    });

    const active = repo.getActiveSession();
    if (!active) return;
    const resume = settings.get().system.resumeAfterRestart && active.status === 'running';
    const session = resume ? active : repo.updateSession(active.id, { status: 'paused' });
    const token = repo.getSessionToken(session.id);
    if (token) {
      try {
        await market.start(token, session.dataSource);
      } catch (err) {
        errors.record('coordinator.recovery', err);
      }
    }
    engine.attach(session.id, { paused: !resume });
    this.startTimers();
    bus.emit('session.updated', { session, token });
    errors.record('coordinator', `Przywrócono sesję #${session.id} po restarcie (${resume ? 'wznowiona' : 'wstrzymana — wznów ręcznie'})`, {
      level: 'warn',
    });
  }

  activeSession(): SessionRecord | null {
    return this.d.repo.getActiveSession();
  }

  private requireActive(): SessionRecord {
    const s = this.activeSession();
    if (!s) throw new UserError('Brak aktywnej sesji');
    return s;
  }

  /** Saldo SOL dostępne dla bota: symulacyjne albo z portfela (live). */
  balanceSol(session: SessionRecord): number | null {
    if (session.mode === 'paper') return session.paperBalanceSol;
    return this.d.wallet.nativeBalance(session.chain);
  }

  currentStats(): SessionStats | null {
    const s = this.activeSession();
    return s ? this.d.stats.compute(s, { balanceSol: this.balanceSol(s) }) : null;
  }

  private emitStats(): void {
    this.d.bus.emit('stats.updated', this.currentStats());
  }

  private snapshotEquity(): void {
    const s = this.activeSession();
    if (!s) return;
    const st = this.d.stats.compute(s, { balanceSol: this.balanceSol(s) });
    this.d.repo.insertEquity(s.id, {
      ts: Date.now(),
      balanceSol: st.balance.sol,
      positionsValueSol: st.positionsValue.sol,
      equitySol: st.currentCapital.sol,
      equityUsd: st.currentCapital.usd,
      solUsd: st.solUsd,
    });
  }

  private startTimers(): void {
    this.stopTimers();
    const equityLoop = () => {
      void this.d.errors.safeRun('coordinator.equity', () => this.snapshotEquity());
      this.equityTimer = setTimeout(equityLoop, this.d.settings.get().system.equitySnapshotSec * 1000);
    };
    equityLoop();
    this.statsTimer = setInterval(() => void this.d.errors.safeRun('coordinator.stats', () => this.emitStats()), 5000);
  }

  private stopTimers(): void {
    if (this.equityTimer) clearTimeout(this.equityTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.equityTimer = null;
    this.statsTimer = null;
  }

  private setStatus(session: SessionRecord, status: SessionStatus): SessionRecord {
    const updated = this.d.repo.updateSession(session.id, { status });
    this.d.bus.emit('session.updated', { session: updated, token: this.d.repo.getSessionToken(updated.id) });
    return updated;
  }

  // ---------- cykl sesji ----------

  async startSession(input: {
    tokenAddress: string;
    mode: ExecutionMode;
    dataSource: DataSource;
    startingCapitalUsd?: number;
    confirmPhrase?: string;
  }): Promise<SessionRecord> {
    const { repo, market, settings, engine, account, rpc, bus } = this.d;
    if (this.activeSession()) throw new UserError('Sesja już trwa — zatrzymaj ją przed rozpoczęciem nowej', 409);
    const cfg = settings.get();

    if (input.mode === 'live') {
      if (!env.liveTradingEnabled) throw new UserError('Tryb live jest wyłączony na serwerze (LIVE_TRADING_ENABLED=false)', 403);
      if (input.dataSource !== 'live') throw new UserError('Tryb live wymaga rzeczywistych danych rynkowych');
      if (input.confirmPhrase !== LIVE_CONFIRM_PHRASE) throw new UserError(`Aby uruchomić handel live, wpisz frazę: ${LIVE_CONFIRM_PHRASE}`);
    }

    const token = await market.resolve(input.tokenAddress, input.dataSource);
    const isSolana = this.d.chains.isSolana(token.chain);
    if (input.mode === 'live') {
      if (isSolana) {
        if (account.getKeypair().address !== account.get().walletAddress) throw new UserError('Klucz prywatny nie pasuje do adresu portfela Solana');
      } else {
        this.d.chains.evm(token.chain); // sieć musi być włączona
        const evmAddress = account.get().evmWalletAddress;
        if (account.getEvmAccount().address.toLowerCase() !== evmAddress.toLowerCase()) throw new UserError('Klucz EVM nie pasuje do adresu portfela EVM');
      }
    }
    const solUsd = token.priceSol > 0 ? token.priceUsd / token.priceSol : await market.getNativeUsd(token.chain);
    let capitalSol: number;
    if (input.mode === 'paper') {
      const usd = input.startingCapitalUsd ?? cfg.trading.paperStartingCapitalUsd;
      if (!(usd > 0)) throw new UserError('Kapitał początkowy musi być dodatni');
      capitalSol = usd / solUsd;
    } else {
      capitalSol = isSolana
        ? (await rpc.getBalanceLamports(account.get().walletAddress)) / 1e9
        : Number(await this.d.evmClients.public(token.chain).getBalance({ address: account.get().evmWalletAddress as Hex })) / 1e18;
      if (capitalSol <= this.d.chains.gasReserve(token.chain)) {
        throw new UserError(`Za mało ${token.nativeSymbol} w portfelu (poniżej rezerwy na opłaty)`);
      }
    }

    const session = repo.createSession({
      token,
      mode: input.mode,
      dataSource: input.dataSource,
      startCapitalSol: capitalSol,
      startCapitalUsd: capitalSol * solUsd,
      startSolUsd: solUsd,
      paperBalanceSol: input.mode === 'paper' ? capitalSol : 0,
      configSnapshot: cfg,
    });
    try {
      await market.start(token, input.dataSource);
    } catch (err) {
      this.d.errors.record('coordinator.start', err);
    }
    if (input.mode === 'live') await this.d.wallet.refresh();
    engine.attach(session.id, { paused: false });
    this.startTimers();
    bus.emit('session.updated', { session, token });
    this.emitStats();
    logger.info({ sessionId: session.id, chain: token.chain, token: token.symbol, mode: input.mode, source: input.dataSource }, 'sesja rozpoczęta');
    return session;
  }

  pause(reason = 'ręcznie'): SessionRecord {
    const s = this.requireActive();
    if (s.status !== 'running') throw new UserError(`Nie można wstrzymać sesji w stanie ${s.status}`);
    const updated = this.setStatus(s, 'paused');
    this.d.engine.pause(reason);
    return updated;
  }

  resume(): SessionRecord {
    const s = this.requireActive();
    if (s.status !== 'paused') throw new UserError(`Nie można wznowić sesji w stanie ${s.status}`);
    if (s.mode === 'live' && !env.liveTradingEnabled) throw new UserError('Tryb live jest wyłączony na serwerze', 403);
    const updated = this.setStatus(s, 'running');
    this.d.engine.resume();
    return updated;
  }

  async stop(opts: { liquidate: boolean }): Promise<SessionRecord> {
    const s = this.requireActive();
    if (this.stopping) throw new UserError('Zatrzymywanie już trwa', 409);
    this.stopping = true;
    try {
      const session = this.setStatus(s, 'stopping');
      this.d.engine.pause('zatrzymywanie sesji');
      this.d.queue.cancelPending(s.id, 'zatrzymanie sesji', 'buy');
      if (opts.liquidate) {
        for (const p of this.d.repo.listOpenPositions(s.id)) {
          this.d.queue.enqueue({ sessionId: s.id, side: 'sell', positionId: p.id, reason: 'manual:stop_liquidation', priority: 5 });
        }
      }
      const drained = await this.d.queue.drain(s.id, 120_000);
      if (!drained) this.d.queue.cancelPending(s.id, 'limit czasu zatrzymania');
      return this.finalize(session, 'stopped');
    } finally {
      this.stopping = false;
    }
  }

  async emergencyStop(): Promise<SessionRecord> {
    const s = this.requireActive();
    const { queue, repo, settings, engine, errors } = this.d;
    const session = this.setStatus(s, 'stopping');
    engine.pause('AWARYJNE ZATRZYMANIE');
    const cancelled = queue.cancelPending(s.id, 'awaryjne zatrzymanie');
    errors.record('coordinator', `Awaryjne zatrzymanie sesji #${s.id} (anulowano ${cancelled} zleceń)`, { level: 'warn' });
    if (settings.get().risk.emergencyLiquidate) {
      for (const p of repo.listOpenPositions(s.id)) {
        queue.enqueue({ sessionId: s.id, side: 'sell', positionId: p.id, reason: 'emergency:liquidation', priority: 10 });
      }
      const drained = await queue.drain(s.id, 60_000);
      if (!drained) queue.cancelPending(s.id, 'limit czasu likwidacji awaryjnej');
    }
    return this.finalize(session, 'emergency_stopped');
  }

  private finalize(session: SessionRecord, status: SessionStatus): SessionRecord {
    const { repo, stats, engine, market, bus } = this.d;
    this.snapshotEquity();
    const fresh = repo.getSession(session.id)!;
    const summary = stats.compute({ ...fresh, endedAt: Date.now() }, { balanceSol: this.balanceSol(fresh) });
    const ended = repo.updateSession(session.id, { status, endedAt: Date.now(), summary });
    engine.detach();
    market.stop();
    this.stopTimers();
    bus.emit('session.updated', { session: ended, token: repo.getSessionToken(ended.id) });
    bus.emit('stats.updated', null);
    logger.info({ sessionId: ended.id, status, pnlUsd: summary.totalPnl.usd }, 'sesja zakończona');
    return ended;
  }

  // ---------- polecenia autoryzowane (z panelu) ----------

  manualBuy(usd: number): Order {
    const s = this.requireActive();
    const { market, settings, risk, stats, queue, repo } = this.d;
    if (!market.isFresh(settings.get().risk.maxDataAgeSeconds) || !market.snapshot) {
      throw new UserError('Brak aktualnych danych rynkowych — zakup wstrzymany');
    }
    const balanceSol = this.balanceSol(s);
    const st = stats.compute(s, { balanceSol });
    const check = risk.checkBuy({
      session: s,
      usd,
      solUsd: market.snapshot.solUsd,
      stats: st,
      openPositions: repo.listOpenPositions(s.id),
      balanceSol,
      manual: true,
    });
    if (!check.ok) throw new UserError(`Zlecenie odrzucone przez limity ryzyka: ${check.reason}`);
    return queue.enqueue({ sessionId: s.id, side: 'buy', valueSol: check.valueSol, reason: 'manual:buy', priority: 1 });
  }

  manualSell(positionId: number): Order {
    const s = this.requireActive();
    const p = this.d.repo.getPosition(positionId);
    if (!p || p.sessionId !== s.id || p.status !== 'open') throw new UserError('Pozycja nie istnieje lub jest zamknięta', 404);
    return this.d.queue.enqueue({ sessionId: s.id, side: 'sell', positionId, reason: 'manual:sell', priority: 2 });
  }

  sellAll(): Order[] {
    const s = this.requireActive();
    return this.d.repo
      .listOpenPositions(s.id)
      .map((p) => this.d.queue.enqueue({ sessionId: s.id, side: 'sell', positionId: p.id, reason: 'manual:sell_all', priority: 2 }));
  }

  private onRiskBreach(reason: string, action: string): void {
    const s = this.activeSession();
    if (!s || s.status !== 'running' || this.stopping) return;
    this.d.errors.record('risk', `Naruszenie limitu: ${reason} → ${action === 'pause' ? 'wstrzymanie' : 'zatrzymanie z likwidacją'}`, {
      level: 'warn',
      throttleMs: 0,
    });
    if (action === 'pause') this.pause(`limit ryzyka: ${reason}`);
    else void this.stop({ liquidate: true }).catch((err) => this.d.errors.record('risk.stop', errorMessage(err)));
  }

  shutdown(): void {
    this.stopTimers();
    this.d.engine.shutdown();
    this.d.market.stop();
  }
}
