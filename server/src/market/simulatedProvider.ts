import type { Candle, MarketSnapshot, Scenario, TokenInfo } from '../../../shared/types.ts';
import { CandleSeries } from './candles.ts';
import type { MarketProvider } from './provider.ts';

/** Parametry reżimów na sekundę: dryf i zmienność log-ceny, mnożnik wolumenu. */
const REGIMES: Record<Scenario, { drift: number; vol: number; volume: number }> = {
  AGGRESSIVE_GROWTH: { drift: 0.0003, vol: 0.0025, volume: 3.0 },
  MODERATE_GROWTH: { drift: 0.00008, vol: 0.0012, volume: 1.4 },
  VOLATILE_GROWTH: { drift: 0.0001, vol: 0.005, volume: 2.0 },
  BASE_BUILDING: { drift: 0, vol: 0.0008, volume: 1.2 },
  STABLE_MARKET: { drift: 0, vol: 0.0005, volume: 0.6 },
  HIGH_VOLATILITY: { drift: 0, vol: 0.007, volume: 2.2 },
  DOWNTREND: { drift: -0.00012, vol: 0.0015, volume: 1.1 },
};
const REGIME_NAMES = Object.keys(REGIMES) as Scenario[];
const ADJ = ['Lunar', 'Turbo', 'Based', 'Cosmic', 'Neon', 'Sleepy', 'Rapid', 'Golden', 'Pixel', 'Quantum'];
const NOUN = ['Cat', 'Frog', 'Penguin', 'Rocket', 'Whale', 'Doge', 'Otter', 'Moth', 'Goblin', 'Bean'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface SimState {
  token: TokenInfo;
  rng: () => number;
  priceUsd: number;
  simTime: number; // ms
  regime: Scenario;
  regimeUntil: number;
  series: CandleSeries;
  volumeLog: { t: number; v: number; buy: boolean }[];
}

/**
 * Symulator rynku do testów i trybu demo: cena jako proces z przełączanymi reżimami
 * (odpowiadającymi scenariuszom analizatora), z wolumenem i płynnością.
 */
export class SimulatedMarketProvider implements MarketProvider {
  readonly source = 'simulated' as const;
  private states = new Map<string, SimState>();
  private nativeUsd: (chain: string) => number;
  private nativeSymbol: (chain: string) => string;

  constructor(nativeUsd: (chain: string) => number, nativeSymbol: (chain: string) => string) {
    this.nativeUsd = nativeUsd;
    this.nativeSymbol = nativeSymbol;
  }

  async getNativeUsd(chain: string): Promise<number> {
    return this.nativeUsd(chain);
  }

  /** Aktualny reżim symulacji (do podglądu w panelu / testów). */
  currentRegime(address: string): Scenario | null {
    return this.states.get(address)?.regime ?? null;
  }

  async resolveToken(address: string, chain: string): Promise<TokenInfo> {
    const existing = this.states.get(address);
    if (existing) return this.withPrice(existing);
    const rng = mulberry32(hash(address));
    const name = `${ADJ[Math.floor(rng() * ADJ.length)]} ${NOUN[Math.floor(rng() * NOUN.length)]}`;
    const symbol = (name.split(' ').map((w) => w.slice(0, 2)).join('') + address.slice(0, 2)).toUpperCase();
    const token: TokenInfo = {
      address,
      chain,
      nativeSymbol: this.nativeSymbol(chain),
      name: `${name} (SIM)`,
      symbol,
      pairAddress: `sim-${address.slice(0, 16)}`,
      dexId: 'simulator',
      quoteSymbol: this.nativeSymbol(chain),
      url: '',
      priceUsd: 0,
      priceSol: 0,
      liquidityUsd: 0,
      volume24hUsd: 0,
      marketCapUsd: 0,
    };
    const state: SimState = {
      token,
      rng,
      priceUsd: 0.00002 + rng() * 0.0002,
      simTime: Date.now() - 3 * 3600_000,
      regime: 'BASE_BUILDING',
      regimeUntil: 0,
      series: new CandleSeries(15, 1200), // baza 15 s → przeliczalna na 15/30/60/300 s…
      volumeLog: [],
    };
    this.states.set(address, state);
    this.advance(state, Date.now());
    return this.withPrice(state);
  }

  private withPrice(st: SimState): TokenInfo {
    const solUsd = this.nativeUsd(st.token.chain);
    return {
      ...st.token,
      priceUsd: st.priceUsd,
      priceSol: st.priceUsd / solUsd,
      liquidityUsd: this.liquidity(st),
      volume24hUsd: this.volumeSince(st, st.simTime - 86_400_000),
      marketCapUsd: st.priceUsd * 1e9,
    };
  }

  private liquidity(st: SimState): number {
    return Math.max(2000, Math.sqrt(st.priceUsd * 1e9) * 120);
  }

  private volumeSince(st: SimState, since: number): number {
    let sum = 0;
    for (let i = st.volumeLog.length - 1; i >= 0 && st.volumeLog[i]!.t >= since; i--) sum += st.volumeLog[i]!.v;
    return sum;
  }

  private gauss(rng: () => number): number {
    const u = Math.max(rng(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  /** Przesuwa symulację do `until` krokami 1 s. */
  private advance(st: SimState, until: number): void {
    const maxSteps = 4 * 3600;
    let steps = 0;
    while (st.simTime + 1000 <= until && steps < maxSteps) {
      st.simTime += 1000;
      steps++;
      if (st.simTime >= st.regimeUntil) {
        st.regime = REGIME_NAMES[Math.floor(st.rng() * REGIME_NAMES.length)]!;
        st.regimeUntil = st.simTime + (180 + st.rng() * 540) * 1000;
      }
      const p = REGIMES[st.regime];
      // lekka siła powrotu, żeby cena nie uciekała w nieskończoność
      const anchor = Math.log(st.priceUsd / 0.0001) * -0.00002;
      const ret = p.drift + anchor + p.vol * this.gauss(st.rng);
      st.priceUsd = Math.max(1e-9, st.priceUsd * Math.exp(ret));
      const volume = (0.5 + st.rng()) * 2.5 * p.volume * (1 + Math.abs(ret) * 400);
      st.volumeLog.push({ t: st.simTime, v: volume, buy: ret >= 0 });
      st.series.ingestTick(st.simTime, st.priceUsd, volume);
    }
    if (steps >= maxSteps) st.simTime = until;
    const cutoff = st.simTime - 86_400_000;
    if (st.volumeLog.length > 100_000 || (st.volumeLog[0] && st.volumeLog[0].t < cutoff)) {
      st.volumeLog = st.volumeLog.filter((x) => x.t >= cutoff);
    }
  }

  /** Stan symulacji żyje w pamięci — po restarcie odtwarzamy go z adresu (deterministyczne ziarno). */
  private async ensure(token: TokenInfo): Promise<SimState> {
    if (!this.states.has(token.address)) await this.resolveToken(token.address, token.chain);
    return this.states.get(token.address)!;
  }

  async fetchSnapshot(token: TokenInfo): Promise<MarketSnapshot> {
    const st = await this.ensure(token);
    this.advance(st, Date.now());
    const solUsd = this.nativeUsd(st.token.chain);
    const last5 = st.volumeLog.filter((x) => x.t >= st.simTime - 300_000);
    const price5mAgo = st.series.bars.find((b) => b.time * 1000 >= st.simTime - 300_000)?.open ?? st.priceUsd;
    const price1hAgo = st.series.bars.find((b) => b.time * 1000 >= st.simTime - 3600_000)?.open ?? st.priceUsd;
    return {
      ts: Date.now(),
      priceUsd: st.priceUsd,
      priceSol: st.priceUsd / solUsd,
      solUsd,
      liquidityUsd: this.liquidity(st),
      volume5mUsd: last5.reduce((a, x) => a + x.v, 0),
      volume1hUsd: this.volumeSince(st, st.simTime - 3600_000),
      volume24hUsd: this.volumeSince(st, st.simTime - 86_400_000),
      buys5m: last5.filter((x) => x.buy).length,
      sells5m: last5.filter((x) => !x.buy).length,
      priceChange5mPct: (st.priceUsd / price5mAgo - 1) * 100,
      priceChange1hPct: (st.priceUsd / price1hAgo - 1) * 100,
    };
  }

  async fetchCandles(token: TokenInfo, timeframeSec: number, limit: number): Promise<Candle[] | null> {
    const st = await this.ensure(token);
    this.advance(st, Date.now());
    if (st.series.timeframeSec === timeframeSec) return st.series.window(limit).map((c) => ({ ...c }));
    if (timeframeSec % st.series.timeframeSec !== 0) return null;
    // przeliczenie świec bazowych na większy interwał (wielokrotność)
    const out = new CandleSeries(timeframeSec, limit);
    for (const c of st.series.bars) {
      out.ingestTick(c.time * 1000, c.open, 0);
      out.ingestTick(c.time * 1000, c.high, 0);
      out.ingestTick(c.time * 1000, c.low, 0);
      out.ingestTick(c.time * 1000, c.close, c.volume);
    }
    return out.window(limit).map((c) => ({ ...c }));
  }
}
