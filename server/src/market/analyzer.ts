import type { AnalysisConfig, Candle, MarketAnalysis, MarketMetrics, Scenario } from '../../../shared/types.ts';
import { clamp } from '../core/util.ts';

function linreg(ys: number[]): { slope: number; r2: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xm;
    const dy = ys[i]! - ym;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, r2 };
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function computeMetrics(candles: Candle[], cfg: AnalysisConfig, liquidityUsd: number): MarketMetrics {
  const closes = candles.map((c) => c.close).filter((c) => c > 0);
  const logs = closes.map(Math.log);
  const { slope, r2 } = linreg(logs);
  const trendSlopePct = (Math.exp(slope) - 1) * 100;
  const k = Math.min(cfg.momentumBars, Math.max(1, closes.length - 1));
  const last = closes[closes.length - 1] ?? 0;
  const ref = closes[closes.length - 1 - k] ?? closes[0] ?? last;
  const ref2 = closes[closes.length - 1 - 2 * k] ?? closes[0] ?? ref;
  const momentumPct = ref > 0 ? (last / ref - 1) * 100 : 0;
  const prevMomentum = ref2 > 0 ? (ref / ref2 - 1) * 100 : 0;
  const returns: number[] = [];
  for (let i = 1; i < logs.length; i++) returns.push(logs[i]! - logs[i - 1]!);
  const volatilityPct = stdev(returns) * 100;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low).filter((l) => l > 0);
  const maxHigh = highs.length ? Math.max(...highs) : 0;
  const minLow = lows.length ? Math.min(...lows) : 0;
  const avgClose = closes.length ? closes.reduce((a, b) => a + b, 0) / closes.length : 0;
  const amplitudePct = avgClose > 0 ? ((maxHigh - minLow) / avgClose) * 100 : 0;
  const half = Math.floor(candles.length / 2);
  const v1 = candles.slice(0, half).reduce((a, c) => a + c.volume, 0);
  const v2 = candles.slice(half).reduce((a, c) => a + c.volume, 0);
  const volumeRatio = v1 > 0 ? v2 / v1 : v2 > 0 ? 2 : 1;
  const flat = cfg.flatSlopePct;
  return {
    trendSlopePct,
    trendR2: r2,
    direction: trendSlopePct > flat ? 'up' : trendSlopePct < -flat ? 'down' : 'flat',
    momentumPct,
    accelerationPct: momentumPct - prevMomentum,
    volatilityPct,
    amplitudePct,
    volumeWindowUsd: v1 + v2,
    volumeRatio,
    liquidityUsd,
    drawdownPct: maxHigh > 0 ? ((maxHigh - last) / maxHigh) * 100 : 0,
  };
}

/**
 * Klasyfikacja scenariusza rynkowego na podstawie okna świec.
 * Reguły sprawdzane w kolejności; progi konfigurowalne z panelu (i zapisywalne jako presety).
 */
export function classify(m: MarketMetrics, cfg: AnalysisConfig): { scenario: Scenario; confidence: number; reasons: string[] } {
  const f = (v: number, d = 2) => v.toFixed(d);
  const trendConf = (ratio: number) => clamp(0.35 + 0.4 * m.trendR2 + 0.25 * clamp(ratio - 1, 0, 1), 0, 1);

  if (m.trendSlopePct <= -cfg.downSlopePct && m.momentumPct < 0) {
    return {
      scenario: 'DOWNTREND',
      confidence: trendConf(-m.trendSlopePct / Math.max(cfg.downSlopePct, 1e-9)),
      reasons: [`nachylenie ${f(m.trendSlopePct)}%/świecę ≤ −${cfg.downSlopePct}`, `momentum ${f(m.momentumPct)}% < 0`],
    };
  }
  if (m.trendSlopePct >= cfg.aggressiveSlopePct && m.momentumPct >= cfg.aggressiveMomentumPct) {
    return {
      scenario: 'AGGRESSIVE_GROWTH',
      confidence: trendConf(m.trendSlopePct / Math.max(cfg.aggressiveSlopePct, 1e-9)),
      reasons: [`nachylenie ${f(m.trendSlopePct)}% ≥ ${cfg.aggressiveSlopePct}`, `momentum ${f(m.momentumPct)}% ≥ ${cfg.aggressiveMomentumPct}`],
    };
  }
  if (m.trendSlopePct >= cfg.moderateSlopePct && m.volatilityPct >= cfg.volatileGrowthVolPct) {
    return {
      scenario: 'VOLATILE_GROWTH',
      confidence: trendConf(m.trendSlopePct / Math.max(cfg.moderateSlopePct, 1e-9)) * 0.9,
      reasons: [`nachylenie ${f(m.trendSlopePct)}% ≥ ${cfg.moderateSlopePct}`, `zmienność ${f(m.volatilityPct)}% ≥ ${cfg.volatileGrowthVolPct}`],
    };
  }
  if (m.trendSlopePct >= cfg.moderateSlopePct) {
    return {
      scenario: 'MODERATE_GROWTH',
      confidence: trendConf(m.trendSlopePct / Math.max(cfg.moderateSlopePct, 1e-9)),
      reasons: [`nachylenie ${f(m.trendSlopePct)}% ≥ ${cfg.moderateSlopePct}`, `R² ${f(m.trendR2)}`],
    };
  }
  if (m.volatilityPct >= cfg.highVolPct) {
    return {
      scenario: 'HIGH_VOLATILITY',
      confidence: clamp(0.5 + 0.5 * (m.volatilityPct / cfg.highVolPct - 1), 0, 1),
      reasons: [`zmienność ${f(m.volatilityPct)}% ≥ ${cfg.highVolPct}`, `brak wyraźnego trendu`],
    };
  }
  const isFlat = Math.abs(m.trendSlopePct) < cfg.flatSlopePct;
  if (isFlat && m.amplitudePct <= cfg.baseMaxAmplitudePct && m.volumeRatio >= cfg.baseMinVolumeRatio) {
    return {
      scenario: 'BASE_BUILDING',
      confidence: clamp(0.4 + 0.3 * (1 - Math.abs(m.trendSlopePct) / cfg.flatSlopePct) + 0.3 * clamp(m.volumeRatio - 1, 0, 1), 0, 1),
      reasons: [`trend płaski (${f(m.trendSlopePct)}%)`, `amplituda ${f(m.amplitudePct)}% ≤ ${cfg.baseMaxAmplitudePct}`, `wolumen ×${f(m.volumeRatio)} ≥ ${cfg.baseMinVolumeRatio}`],
    };
  }
  if (m.volatilityPct <= cfg.stableMaxVolPct) {
    return {
      scenario: 'STABLE_MARKET',
      confidence: clamp(0.5 + 0.5 * (1 - m.volatilityPct / Math.max(cfg.stableMaxVolPct, 1e-9)), 0, 1),
      reasons: [`zmienność ${f(m.volatilityPct)}% ≤ ${cfg.stableMaxVolPct}`],
    };
  }
  // Słabe sygnały: niska pewność (0.25), więc przy domyślnym minConfidence = 0.3 nie uruchamiają wejść.
  const weak = 0.25;
  if (m.volatilityPct >= cfg.volatileGrowthVolPct) {
    return m.trendSlopePct > cfg.flatSlopePct
      ? { scenario: 'VOLATILE_GROWTH', confidence: weak, reasons: [`słaby wzrost (${f(m.trendSlopePct)}%) przy zmienności ${f(m.volatilityPct)}%`] }
      : { scenario: 'HIGH_VOLATILITY', confidence: weak, reasons: [`podwyższona zmienność ${f(m.volatilityPct)}% bez trendu`] };
  }
  if (m.trendSlopePct < -cfg.flatSlopePct) {
    return { scenario: 'DOWNTREND', confidence: weak, reasons: [`słaby spadek (${f(m.trendSlopePct)}%)`] };
  }
  if (m.trendSlopePct > cfg.flatSlopePct) {
    return { scenario: 'MODERATE_GROWTH', confidence: weak, reasons: [`słaby wzrost (${f(m.trendSlopePct)}%)`] };
  }
  return { scenario: 'STABLE_MARKET', confidence: weak, reasons: ['brak wyraźnych cech — klasyfikacja domyślna'] };
}

export function analyze(candles: Candle[], cfg: AnalysisConfig, liquidityUsd: number, now = Date.now()): MarketAnalysis {
  const window = candles.slice(-cfg.lookbackCandles);
  const metrics = computeMetrics(window, cfg, liquidityUsd);
  if (window.length < cfg.minSamples) {
    return {
      ts: now,
      scenario: 'STABLE_MARKET',
      confidence: 0,
      insufficientData: true,
      sampleSize: window.length,
      metrics,
      reasons: [`za mało danych: ${window.length}/${cfg.minSamples} świec`],
    };
  }
  const { scenario, confidence, reasons } = classify(metrics, cfg);
  return { ts: now, scenario, confidence, insufficientData: false, sampleSize: window.length, metrics, reasons };
}
