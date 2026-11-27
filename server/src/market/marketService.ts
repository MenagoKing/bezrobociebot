import type {
  Candle,
  DataSource,
  FeedHealth,
  MarketAnalysis,
  MarketSnapshot,
  TokenInfo,
  TokenPreview,
  TokenSearchResult,
} from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import type { EventBus } from '../core/eventBus.ts';
import { UserError } from '../core/util.ts';
import { ChartCandles, type Tick } from './chartCandles.ts';
import { analyze } from './analyzer.ts';
import { CandleSeries } from './candles.ts';
import { LiveMarketProvider } from './liveProvider.ts';
import { parseTokenInput, type MarketProvider } from './provider.ts';
import { SOLANA } from '../../../shared/types.ts';
import type { ChainRegistry } from '../chains/chainRegistry.ts';
import { SimulatedMarketProvider } from './simulatedProvider.ts';

/**
 * Feed rynkowy wybranego tokena: cykliczne pobieranie ceny, odświeżanie świec,
 * analiza scenariusza i publikacja zdarzeń. Błędy źródła obniżają status feedu
 * (ok → degraded → down) i wydłużają odstęp między próbami, ale nie zatrzymują procesu.
 */
export class MarketService {
  token: TokenInfo | null = null;
  snapshot: MarketSnapshot | null = null;
  analysis: MarketAnalysis | null = null;
  readonly series = new CandleSeries(60);
  feed: FeedHealth = { status: 'idle', source: null, lastTickAt: null, lastCandleRefreshAt: null, consecutiveErrors: 0, lastError: null };

  readonly live: LiveMarketProvider;
  readonly simulated: SimulatedMarketProvider;
  private chains: ChainRegistry;
  private provider: MarketProvider | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private candleTimer: NodeJS.Timeout | null = null;
  private lastAnalysisEmit = 0;
  private lastTickEmit = 0;
  private hasApiCandles = false;
  private needsFullCandles = false;
  private generation = 0;
  private nativeUsdCache = new Map<string, number>();
  /** ceny z feedu (co marketPollMs) — z nich powstają świece sekundowe na wykresie */
  private ticks: Tick[] = [];
  private chart!: ChartCandles;

  private bus: EventBus;
  private settings: SettingsService;
  private errors: ErrorMonitor;

  constructor(bus: EventBus, settings: SettingsService, errors: ErrorMonitor, chains: ChainRegistry) {
    this.bus = bus;
    this.settings = settings;
    this.errors = errors;
    this.chains = chains;
    this.live = new LiveMarketProvider(chains);
    this.simulated = new SimulatedMarketProvider(
      (chain) => chains.simulatedNativeUsd(chain),
      (chain) => chains.nativeSymbol(chain),
    );
    this.chart = new ChartCandles(this.live, {
      sessionToken: () => this.token,
      sessionSnapshot: () => this.snapshot,
      sessionTicks: () => this.ticks,
      sessionSeries: () => ({ tf: this.series.timeframeSec, bars: this.series.bars }),
      resolve: (address) => this.resolve(address, 'live'),
    });
    bus.on('settings.updated', (s) => {
      if (this.token && s.analysis.timeframeSec !== this.series.timeframeSec) {
        void this.reloadCandles();
      }
    });
  }

  providerFor(source: DataSource): MarketProvider {
    return source === 'live' ? this.live : this.simulated;
  }

  /**
   * Rozpoznaje token z wklejonego adresu lub linku: adres base58 → Solana, adres 0x… → sieć EVM
   * (dane rzeczywiste: włączona sieć z największą płynnością; symulator: pierwsza włączona sieć EVM).
   */
  async resolve(input: string, source: DataSource): Promise<TokenInfo> {
    const parsed = parseTokenInput(input);
    if (!parsed) throw new UserError('Nieprawidłowy adres tokena — wklej adres kontraktu (Solana lub 0x… dla sieci EVM) albo link do tokena');
    if (parsed.kind === 'solana') return this.providerFor(source).resolveToken(parsed.address, SOLANA);
    if (source === 'live') return this.live.resolveEvmToken(parsed.address);
    const chain = this.chains.enabledEvm()[0];
    if (!chain) throw new UserError('Brak włączonej sieci EVM (Ustawienia → Sieci i połączenia)');
    return this.simulated.resolveToken(parsed.address, chain.key);
  }

  /**
   * Podgląd tokena przed startem sesji: cena, świece i analiza scenariusza — bez uruchamiania feedu i bota.
   * Błąd pobierania ceny lub świec nie blokuje podglądu (zwraca to, co się udało).
   */
  /** Wyszukiwanie tokena po nazwie/symbolu — zawsze w danych rzeczywistych (symulator nie ma listy tokenów). */
  search(query: string): Promise<TokenSearchResult[]> {
    return this.live.search(query);
  }

  /** Świece tylko do wyświetlenia na wykresie, w interwale wybranym przez użytkownika (analiza bota się nie zmienia). */
  chartCandles(input: string, timeframeSec: number): Promise<Candle[]> {
    const parsed = parseTokenInput(input);
    if (!parsed) throw new UserError('Nieprawidłowy adres tokena');
    return this.chart.get(parsed.address, timeframeSec);
  }

  async preview(input: string, source: DataSource): Promise<TokenPreview> {
    const token = await this.resolve(input, source);
    const provider = this.providerFor(source);
    const { analysis: cfg } = this.settings.get();
    const [snapshot, candles] = await Promise.all([
      provider.fetchSnapshot(token).catch(() => null),
      provider.fetchCandles(token, cfg.timeframeSec, Math.max(cfg.lookbackCandles * 3, 200)).catch(() => null),
    ]);
    const bars = candles ?? [];
    this.chart.seed(token.address, cfg.timeframeSec, bars);
    const analysis = bars.length ? analyze(bars, cfg, snapshot?.liquidityUsd ?? token.liquidityUsd) : null;
    return { token, snapshot, candles: bars, analysis, timeframeSec: cfg.timeframeSec };
  }

  async start(token: TokenInfo, source: DataSource): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this.token = token;
    this.provider = this.providerFor(source);
    this.feed = { status: 'degraded', source, lastTickAt: null, lastCandleRefreshAt: null, consecutiveErrors: 0, lastError: null };
    this.series.reset(this.settings.get().analysis.timeframeSec);
    this.snapshot = null;
    this.analysis = null;
    this.ticks = [];
    await this.refreshCandles(gen);
    await this.poll(gen);
    this.scheduleCandles(gen);
  }

  stop(): void {
    this.generation++;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.candleTimer) clearTimeout(this.candleTimer);
    this.pollTimer = null;
    this.candleTimer = null;
    this.provider = null;
    this.token = null;
    this.snapshot = null;
    this.analysis = null;
    this.series.reset(this.series.timeframeSec);
    this.feed = { status: 'idle', source: null, lastTickAt: null, lastCandleRefreshAt: null, consecutiveErrors: 0, lastError: null };
    this.bus.emit('market.feed', this.feed);
  }

  private async reloadCandles(): Promise<void> {
    this.series.reset(this.settings.get().analysis.timeframeSec);
    this.needsFullCandles = true;
    await this.refreshCandles(this.generation);
    this.runAnalysis(true);
  }

  private async refreshCandles(gen: number): Promise<void> {
    if (!this.token || !this.provider) return;
    const { analysis } = this.settings.get();
    try {
      const candles = await this.provider.fetchCandles(this.token, analysis.timeframeSec, Math.max(analysis.lookbackCandles * 3, 200));
      if (gen !== this.generation) return;
      this.hasApiCandles = candles !== null;
      if (candles?.length) {
        const replace = this.feed.lastCandleRefreshAt === null || this.needsFullCandles;
        this.needsFullCandles = false;
        this.series.merge(candles);
        this.chart.seed(this.token.address, analysis.timeframeSec, this.series.bars);
        this.feed.lastCandleRefreshAt = Date.now();
        // pełna seria przy starcie/zmianie interwału, potem tylko ostatnie świece (mniej danych w SSE)
        this.bus.emit('market.candles', { candles: replace ? this.series.bars : this.series.bars.slice(-3), replace });
      }
    } catch (err) {
      this.errors.record('market.candles', err, { level: 'warn', throttleMs: 120_000 });
    }
  }

  private scheduleCandles(gen: number): void {
    if (!this.hasApiCandles || gen !== this.generation) return;
    this.candleTimer = setTimeout(async () => {
      await this.refreshCandles(gen);
      this.scheduleCandles(gen);
    }, this.settings.get().system.candleRefreshSec * 1000);
  }

  private async poll(gen: number): Promise<void> {
    if (!this.token || !this.provider || gen !== this.generation) return;
    const { system } = this.settings.get();
    try {
      const snap = await this.provider.fetchSnapshot(this.token);
      if (gen !== this.generation) return;
      const prevTs = this.snapshot?.ts ?? snap.ts - system.marketPollMs;
      this.snapshot = snap;
      this.nativeUsdCache.set(this.token.chain, snap.solUsd);
      // bez świec z API wolumen świecy szacujemy z bieżącego tempa (wolumen 5 min)
      const volumeDelta = this.hasApiCandles ? 0 : (snap.volume5mUsd / 300) * ((snap.ts - prevTs) / 1000);
      const candle = this.series.ingestTick(snap.ts, snap.priceUsd, Math.max(0, volumeDelta));
      this.ticks.push({ ts: snap.ts, price: snap.priceUsd, vol: Math.max(0, (snap.volume5mUsd / 300) * ((snap.ts - prevTs) / 1000)) });
      if (this.ticks.length > 6000) this.ticks.splice(0, this.ticks.length - 6000);
      const wasDown = this.feed.status !== 'ok';
      this.feed = { ...this.feed, status: 'ok', lastTickAt: snap.ts, consecutiveErrors: 0, lastError: null };
      if (wasDown) this.bus.emit('market.feed', this.feed);
      if (snap.ts - this.lastTickEmit >= 900) {
        this.lastTickEmit = snap.ts;
        this.bus.emit('market.tick', { snapshot: snap, candle: { ...candle } });
      }
      this.runAnalysis(false);
    } catch (err) {
      if (gen !== this.generation) return;
      this.feed.consecutiveErrors++;
      this.feed.lastError = (err as Error).message;
      this.feed.status = this.feed.consecutiveErrors >= 5 ? 'down' : 'degraded';
      this.bus.emit('market.feed', this.feed);
      this.errors.record('market.feed', err, { level: this.feed.status === 'down' ? 'error' : 'warn', throttleMs: 60_000 });
    } finally {
      if (gen === this.generation) {
        const backoff = Math.min(8, 2 ** Math.max(0, this.feed.consecutiveErrors - 1));
        this.pollTimer = setTimeout(() => void this.poll(gen), system.marketPollMs * (this.feed.consecutiveErrors ? backoff : 1));
      }
    }
  }

  private runAnalysis(force: boolean): void {
    const now = Date.now();
    this.analysis = analyze(this.series.bars, this.settings.get().analysis, this.snapshot?.liquidityUsd ?? 0, now);
    if (force || now - this.lastAnalysisEmit >= 2000) {
      this.lastAnalysisEmit = now;
      this.bus.emit('market.analysis', this.analysis);
    }
  }

  /** Analiza na żądanie (np. po zmianie progów w panelu). */
  reanalyze(): MarketAnalysis | null {
    if (!this.token) return null;
    this.runAnalysis(true);
    return this.analysis;
  }

  isFresh(maxAgeSec: number): boolean {
    return !!this.snapshot && Date.now() - this.snapshot.ts <= maxAgeSec * 1000;
  }

  candles(): Candle[] {
    return this.series.bars;
  }

  /**
   * Kurs waluty natywnej w USD (domyślnie sieci bieżącego tokena): z feedu, potem z DexScreener,
   * na końcu wartość z symulatora.
   */
  async getNativeUsd(chain = this.token?.chain ?? SOLANA): Promise<number> {
    if (this.snapshot && this.token?.chain === chain && Date.now() - this.snapshot.ts < 120_000) return this.snapshot.solUsd;
    if (this.feed.source === 'simulated' && this.token?.chain === chain) return this.chains.simulatedNativeUsd(chain);
    try {
      const v = await this.live.getNativeUsd(chain);
      this.nativeUsdCache.set(chain, v);
      return v;
    } catch (err) {
      this.errors.record('market.nativeusd', err, { level: 'warn', throttleMs: 300_000 });
      return this.nativeUsdCache.get(chain) ?? this.chains.simulatedNativeUsd(chain);
    }
  }

  /** Synchroniczny kurs waluty natywnej bieżącego tokena (ostatnia znana wartość). */
  solUsdNow(): number {
    const chain = this.token?.chain ?? SOLANA;
    return this.snapshot?.solUsd ?? this.nativeUsdCache.get(chain) ?? this.chains.simulatedNativeUsd(chain);
  }
}
