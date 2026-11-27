import type { Candle, MarketSnapshot, TokenInfo } from '../../../shared/types.ts';
import { RetryableError, UserError } from '../core/util.ts';
import type { LiveMarketProvider } from './liveProvider.ts';

/** Interwały wykresu (s). Poniżej minuty świece powstają z ticków ceny, od minuty — z GeckoTerminal. */
export const CHART_TFS = [1, 5, 15, 30, 60, 300, 900, 3600, 14400, 43200, 86400] as const;
const SUB_MINUTE_POLL_MS = 3000;
const WATCH_IDLE_MS = 90_000;
const MAX_TICKS = 6000;
/** ile czekamy na GeckoTerminal, zanim oddamy świece zapasowe (zapytanie kończy się w tle i zasila cache) */
const RESPONSE_DEADLINE_MS = 6000;

export interface Tick {
  ts: number;
  price: number;
  vol: number;
}

/** Jak długo świece z API uznajemy za świeże — ostatnią świecę i tak dociągamy do bieżącej ceny. */
function ttlMs(tf: number): number {
  if (tf <= 60) return 15_000;
  if (tf <= 300) return 30_000;
  if (tf <= 900) return 45_000;
  return 90_000;
}

/** Świece z ticków ceny (rozdzielczość = odstęp pobierania ceny). */
export function candlesFromTicks(ticks: Tick[], tf: number): Candle[] {
  const out: Candle[] = [];
  let prevClose: number | null = null;
  for (const t of ticks) {
    const time = Math.floor(t.ts / 1000 / tf) * tf;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, t.price);
      last.low = Math.min(last.low, t.price);
      last.close = t.price;
      last.volume += t.vol;
    } else {
      const open: number = prevClose ?? t.price;
      out.push({ time, open, high: Math.max(open, t.price), low: Math.min(open, t.price), close: t.price, volume: t.vol });
    }
    prevClose = t.price;
  }
  return out.slice(-1000);
}

/** Składa świece drobniejszego interwału w grubszy (np. 1 h → 4 h). */
export function aggregate(candles: Candle[], toTf: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const time = Math.floor(c.time / toTf) * toTf;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, time });
    }
  }
  return out;
}

/** Dociąga ostatnią świecę do bieżącej ceny (albo otwiera nową), żeby wykres był na żywo bez zapytań do API. */
function withLivePrice(candles: Candle[], tf: number, snap: MarketSnapshot | null): Candle[] {
  if (!snap || !candles.length || !(snap.priceUsd > 0)) return candles;
  const out = candles.slice();
  const last = { ...out[out.length - 1]! };
  const time = Math.floor(snap.ts / 1000 / tf) * tf;
  if (time === last.time) {
    last.high = Math.max(last.high, snap.priceUsd);
    last.low = Math.min(last.low, snap.priceUsd);
    last.close = snap.priceUsd;
    out[out.length - 1] = last;
  } else if (time > last.time) {
    out.push({ time, open: last.close, high: Math.max(last.close, snap.priceUsd), low: Math.min(last.close, snap.priceUsd), close: snap.priceUsd, volume: 0 });
  }
  return out;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> =>
  Promise.race([p, new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), ms))]);
const TIMEOUT = Symbol('timeout');

interface Source {
  /** token sesji, jeśli to ten sam co na wykresie */
  sessionToken: () => TokenInfo | null;
  sessionSnapshot: () => MarketSnapshot | null;
  sessionTicks: () => Tick[];
  /** świece bota (interwał analizy) — najświeższe, bez dodatkowych zapytań */
  sessionSeries: () => { tf: number; bars: Candle[] };
  resolve: (address: string) => Promise<TokenInfo>;
}

/**
 * Świece do wykresu w dowolnym interwale, odporne na limity i awarie API:
 * - cache z czasem życia zależnym od interwału + łączenie równoległych zapytań o to samo,
 * - ostatnia świeca zawsze dociągnięta do bieżącej ceny,
 * - gdy GeckoTerminal nie odpowiada: stary cache → złożenie z drobniejszego interwału → świece bota,
 * - interwały sekundowe z ticków ceny: w sesji z feedu bota, poza sesją z własnego, lekkiego podglądu ceny.
 */
export class ChartCandles {
  private cache = new Map<string, { at: number; candles: Candle[] }>();
  private inflight = new Map<string, Promise<Candle[]>>();
  private tokens = new Map<string, TokenInfo>();
  private watch: { address: string; token: TokenInfo; ticks: Tick[]; snap: MarketSnapshot | null; lastReq: number; timer: NodeJS.Timeout | null } | null = null;
  private live: LiveMarketProvider;
  private src: Source;

  constructor(live: LiveMarketProvider, src: Source) {
    this.live = live;
    this.src = src;
  }

  async get(address: string, tf: number): Promise<Candle[]> {
    const addr = address.toLowerCase();
    const session = this.src.sessionToken();
    const inSession = !!session && session.address.toLowerCase() === addr;

    if (tf < 60) return this.subMinute(address, addr, tf, inSession);

    const snap = inSession ? this.src.sessionSnapshot() : this.watch?.address === addr ? this.watch.snap : null;
    if (inSession) {
      const series = this.src.sessionSeries();
      if (series.tf === tf && series.bars.length) return series.bars.slice();
    }

    const key = `${addr}:${tf}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs(tf)) return withLivePrice(hit.candles, tf, snap);

    const token = inSession ? session! : await this.token(address);
    let req = this.inflight.get(key);
    if (!req) {
      req = this.live
        .fetchCandles(token, tf, 1000)
        .then((c) => {
          const candles = c ?? [];
          if (candles.length) this.store(key, candles);
          return candles;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, req);
    }
    // są już (nieco starsze) świece: oddajemy je od razu, a świeże dociągają się w tle
    if (hit) {
      req.catch(() => undefined);
      return withLivePrice(hit.candles, tf, snap);
    }
    // da się złożyć sensowny wykres z drobniejszego interwału: pokazujemy go od razu, prawdziwe świece przyjdą w tle
    const quick = this.fallback(addr, tf, inSession);
    if (quick.length >= 20) {
      req.catch(() => undefined);
      return withLivePrice(quick, tf, snap);
    }

    try {
      const res = await withTimeout(req, RESPONSE_DEADLINE_MS);
      if (res !== TIMEOUT && res.length) return withLivePrice(res, tf, snap);
      if (res !== TIMEOUT && !res.length) {
        const fb = this.fallback(addr, tf, inSession);
        if (fb.length) return withLivePrice(fb, tf, snap);
        return [];
      }
    } catch (err) {
      if (!(err instanceof RetryableError)) {
        const fb = this.fallback(addr, tf, inSession);
        if (fb.length) return withLivePrice(fb, tf, snap);
        throw err;
      }
    }
    // limit zapytań / wolna odpowiedź / awaria sieci: oddajemy to, co mamy
    const fb = this.fallback(addr, tf, inSession);
    if (fb.length) return withLivePrice(fb, tf, snap);
    throw new UserError('GeckoTerminal chwilowo nie odpowiada — świece pojawią się za chwilę', 503);
  }

  /** Świece pobrane przez bota albo podgląd — zasilają cache wykresu (źródło do składania grubszych interwałów). */
  seed(address: string, tf: number, candles: Candle[]): void {
    if (candles.length) this.store(`${address.toLowerCase()}:${tf}`, candles.slice());
  }

  private store(key: string, candles: Candle[]): void {
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), candles });
    if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Świece zapasowe: złożone z drobniejszego interwału z cache albo ze świec bota. */
  private fallback(addr: string, tf: number, inSession: boolean): Candle[] {
    let best: Candle[] = [];
    for (const [key, v] of this.cache) {
      const [a, t] = key.split(':');
      const from = Number(t);
      if (a !== addr || from >= tf || tf % from !== 0) continue;
      const agg = aggregate(v.candles, tf);
      if (agg.length > best.length) best = agg;
    }
    if (!best.length && inSession) {
      const series = this.src.sessionSeries();
      if (series.tf < tf && tf % series.tf === 0 && series.bars.length) best = aggregate(series.bars, tf);
    }
    return best;
  }

  private async token(address: string): Promise<TokenInfo> {
    const addr = address.toLowerCase();
    const cached = this.tokens.get(addr);
    if (cached) return cached;
    const token = await this.src.resolve(address);
    this.tokens.set(addr, token);
    if (this.tokens.size > 50) this.tokens.delete(this.tokens.keys().next().value!);
    return token;
  }

  private async subMinute(address: string, addr: string, tf: number, inSession: boolean): Promise<Candle[]> {
    if (inSession && this.src.sessionTicks().length) return candlesFromTicks(this.src.sessionTicks(), tf);
    // poza sesją (podgląd tokena): własny lekki podgląd ceny, wyłączany po chwili bez zapytań
    if (!this.watch || this.watch.address !== addr) {
      this.stopWatch();
      const token = await this.token(address);
      this.watch = { address: addr, token, ticks: [], snap: null, lastReq: Date.now(), timer: null };
      await this.pollWatch();
    }
    this.watch.lastReq = Date.now();
    return candlesFromTicks(this.watch.ticks, tf);
  }

  private async pollWatch(): Promise<void> {
    const w = this.watch;
    if (!w) return;
    if (Date.now() - w.lastReq > WATCH_IDLE_MS) return this.stopWatch();
    try {
      const snap = await this.live.fetchSnapshot(w.token);
      if (this.watch !== w) return;
      const prevTs = w.snap?.ts ?? snap.ts - SUB_MINUTE_POLL_MS;
      w.snap = snap;
      w.ticks.push({ ts: snap.ts, price: snap.priceUsd, vol: Math.max(0, (snap.volume5mUsd / 300) * ((snap.ts - prevTs) / 1000)) });
      if (w.ticks.length > MAX_TICKS) w.ticks.splice(0, w.ticks.length - MAX_TICKS);
    } catch {
      // chwilowy błąd źródła ceny — kolejna próba za chwilę
    }
    if (this.watch === w) w.timer = setTimeout(() => void this.pollWatch(), SUB_MINUTE_POLL_MS);
  }

  private stopWatch(): void {
    if (this.watch?.timer) clearTimeout(this.watch.timer);
    this.watch = null;
  }

  close(): void {
    this.stopWatch();
  }
}
