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
import { useEffect, useRef } from 'react';
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
export function CandleChart({ candles, height = 400 }: { candles: Candle[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const shown = useRef<{ first: number; count: number }>({ first: 0, count: 0 });

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, baseOptions());
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
  }, [height]);

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
