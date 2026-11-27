import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api.ts';
import type { Candle, EquityPoint } from '../../../shared/types.ts';
import { fmtPrice } from '../format.ts';

const UP = '#19c37d';
const DOWN = '#f0454f';

function baseOptions() {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#7f8b9c',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 11,
      panes: { separatorColor: '#1d2531' },
    },
    grid: { vertLines: { color: 'rgba(29,37,49,0.6)' }, horzLines: { color: 'rgba(29,37,49,0.6)' } },
    rightPriceScale: { borderColor: '#1d2531' },
    timeScale: { borderColor: '#1d2531', timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
  };
}

/** Wykres świecowy z wolumenem w osobnym panelu; aktualizacje przyrostowe. */
export function CandleChart({ candles, height = 400, seconds = false }: { candles: Candle[]; height?: number; seconds?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const shown = useRef<{ first: number; count: number }>({ first: 0, count: 0 });

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, { ...baseOptions(), timeScale: { ...baseOptions().timeScale, secondsVisible: seconds } });
    price.current = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: 'custom', formatter: (p: number) => fmtPrice(p), minMove: 1e-12 },
    });
    volume.current = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
    try {
      c.panes()[1]?.setHeight(Math.round(height * 0.22));
    } catch {
      // starsze wersje bez API paneli
    }
    chart.current = c;
    shown.current = { first: 0, count: 0 };
    return () => {
      c.remove();
      chart.current = null;
    };
  }, [height, seconds]);

  useEffect(() => {
    const p = price.current;
    const v = volume.current;
    if (!p || !v) return;
    const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
    const toVol = (c: Candle) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? 'rgba(25,195,125,0.45)' : 'rgba(240,69,79,0.45)' });
    const first = candles[0]?.time ?? 0;
    const prev = shown.current;
    const incremental = prev.count > 0 && first === prev.first && candles.length - prev.count <= 1 && candles.length >= prev.count;
    if (incremental && candles.length) {
      const last = candles[candles.length - 1]!;
      p.update(toBar(last));
      v.update(toVol(last));
    } else {
      p.setData(candles.map(toBar));
      v.setData(candles.map(toVol));
      if (prev.count === 0 && candles.length) chart.current?.timeScale().fitContent();
    }
    shown.current = { first, count: candles.length };
  }, [candles]);

  return <div ref={box} className="chart-box" style={{ height }} />;
}

export const CHART_TIMEFRAMES: [number, string][] = [
  [1, '1s'],
  [5, '5s'],
  [15, '15s'],
  [30, '30s'],
  [60, '1m'],
  [300, '5m'],
  [900, '15m'],
  [3600, '1h'],
  [14400, '4h'],
  [43200, '12h'],
  [86400, '1D'],
];
const TF_KEY = 'soldesk.chartTf';

/** świece pobrane w tej karcie — powrót do interwału pokazuje je od razu */
const tfCache = new Map<string, Candle[]>();

function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Brak połączenia z serwerem aplikacji';
}

/**
 * Wykres świecowy z przełącznikiem interwału. W interwale bota pokazuje świece na żywo (baseCandles),
 * w innym pobiera świece z serwera i odświeża je (sekundowe co 3 s, pozostałe co 15 s).
 * Błąd nie czyści wykresu: zostają ostatnie świece, a pobieranie ponawia się samo z rosnącym odstępem.
 */
export function TimeframeChart({ address, baseCandles, baseTf, height, empty }: { address: string; baseCandles: Candle[]; baseTf: number; height: number; empty?: string }) {
  const [tf, setTf] = useState<number>(() => {
    const saved = Number(localStorage.getItem(TF_KEY));
    return CHART_TIMEFRAMES.some(([v]) => v === saved) ? saved : baseTf;
  });
  const key = `${address}:${tf}`;
  const [own, setOwn] = useState<{ key: string; candles: Candle[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const useBase = tf === baseTf && baseCandles.length > 0;

  useEffect(() => {
    if (useBase) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const cached = tfCache.get(key);
    setOwn(cached ? { key, candles: cached } : null);
    setProblem(null);
    const load = async () => {
      try {
        const c = await api.get<Candle[]>(`/api/token/candles?address=${encodeURIComponent(address)}&tf=${tf}`);
        if (!alive) return;
        failures = 0;
        if (c.length || !tfCache.get(key)?.length) {
          tfCache.set(key, c);
          setOwn({ key, candles: c });
        }
        setProblem(null);
      } catch (e) {
        if (!alive) return;
        failures++;
        setProblem(friendlyError(e));
      }
      if (alive) timer = setTimeout(load, failures ? Math.min(8_000, 2000 * 2 ** (failures - 1)) : tf < 60 ? 3_000 : 15_000);
    };
    void load();
    // po powrocie do karty albo odzyskaniu sieci — od razu nowe dane
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      void load();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [address, tf, useBase, key]);

  const pick = (v: number) => {
    setTf(v);
    localStorage.setItem(TF_KEY, String(v));
  };
  const candles = useBase ? baseCandles : own?.key === key ? own.candles : null;
  const note = useBase ? 'na żywo · interwał bota' : tf < 60 ? 'na żywo z ceny pobieranej co 3 s' : 'na żywo · historia odświeżana co 15 s';

  return (
    <>
      <div className="chart-toolbar">
        <span className="ths-label">Interwał</span>
        <div className="seg seg-sm" role="group" aria-label="Interwał świec">
          {CHART_TIMEFRAMES.map(([v, label]) => (
            <button key={v} className={tf === v ? 'on' : ''} onClick={() => pick(v)} title={v === baseTf ? 'Interwał, na którym analizuje bot (na żywo)' : undefined}>
              {label}
              {v === baseTf && <span className="tf-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        {problem ? <span className="small chart-retry">{problem} — ponawiam…</span> : <span className="small faint">{note}</span>}
      </div>
      {candles === null ? (
        <div className="empty" style={{ height, display: 'grid', placeItems: 'center' }}>
          {problem ? 'Ponawiam pobieranie świec…' : 'Ładuję świece…'}
        </div>
      ) : candles.length ? (
        <CandleChart key={key} candles={candles} height={height} seconds={tf < 60} />
      ) : (
        <div className="empty" style={{ height, display: 'grid', placeItems: 'center' }}>
          {tf < 60 ? 'Zbieram ceny — świece sekundowe pojawią się za kilka sekund' : (empty ?? 'Brak świec w tym interwale')}
        </div>
      )}
    </>
  );
}

/** Krzywa kapitału (USD). */
export function EquityChart({ points, height = 240 }: { points: EquityPoint[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);
  const chart = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, { ...baseOptions(), timeScale: { borderColor: '#1d2531', timeVisible: true, secondsVisible: true } });
    series.current = c.addSeries(AreaSeries, {
      lineColor: '#8b6cff',
      topColor: 'rgba(139,108,255,0.35)',
      bottomColor: 'rgba(139,108,255,0.02)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (p: number) => `$${p.toFixed(p < 10 ? 4 : 2)}`, minMove: 0.0001 },
    });
    chart.current = c;
    return () => c.remove();
  }, []);

  useEffect(() => {
    if (!series.current) return;
    const seen = new Set<number>();
    const data = points
      .map((p) => ({ time: Math.floor(p.ts / 1000) as UTCTimestamp, value: p.equityUsd }))
      .filter((d) => (seen.has(d.time) ? false : (seen.add(d.time), true)));
    series.current.setData(data);
    chart.current?.timeScale().fitContent();
  }, [points]);

  return <div ref={box} className="chart-box" style={{ height }} />;
}
