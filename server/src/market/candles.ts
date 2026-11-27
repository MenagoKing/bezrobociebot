import type { Candle } from '../../../shared/types.ts';

/** Seria świec w pamięci: historia z API + bieżąca świeca budowana z ticków. */
export class CandleSeries {
  timeframeSec: number;
  private max: number;
  bars: Candle[] = [];

  constructor(timeframeSec: number, max = 600) {
    this.timeframeSec = timeframeSec;
    this.max = max;
  }

  reset(timeframeSec: number): void {
    this.timeframeSec = timeframeSec;
    this.bars = [];
  }

  bucket(tsMs: number): number {
    return Math.floor(tsMs / 1000 / this.timeframeSec) * this.timeframeSec;
  }

  /** Scala świece z API; świece zamknięte bierze z API, bieżącą łączy z danymi z ticków. */
  merge(candles: Candle[]): void {
    if (!candles.length) return;
    const byTime = new Map(this.bars.map((b) => [b.time, b]));
    const lastApi = candles[candles.length - 1]!.time;
    for (const c of candles) {
      const existing = byTime.get(c.time);
      if (existing && c.time === lastApi) {
        byTime.set(c.time, {
          time: c.time,
          open: c.open,
          high: Math.max(c.high, existing.high),
          low: Math.min(c.low, existing.low),
          close: existing.close,
          volume: Math.max(c.volume, existing.volume),
        });
      } else {
        byTime.set(c.time, { ...c });
      }
    }
    this.bars = [...byTime.values()].sort((a, b) => a.time - b.time).slice(-this.max);
  }

  ingestTick(tsMs: number, price: number, volumeDelta = 0): Candle {
    const time = this.bucket(tsMs);
    const last = this.bars[this.bars.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += volumeDelta;
      return last;
    }
    if (last && time < last.time) return last; // spóźniony tick
    const open = last ? last.close : price;
    const bar: Candle = {
      time,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume: volumeDelta,
    };
    this.bars.push(bar);
    if (this.bars.length > this.max) this.bars.splice(0, this.bars.length - this.max);
    return bar;
  }

  last(): Candle | null {
    return this.bars[this.bars.length - 1] ?? null;
  }

  window(n: number): Candle[] {
    return this.bars.slice(-n);
  }
}
