const nf = (min: number, max: number) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: min, maximumFractionDigits: max });
const usd2 = nf(2, 2);
const usd4 = nf(4, 4);

export function fmtUsd(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = signed && v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  return `${sign}$${a !== 0 && a < 0.01 ? usd4.format(a) : usd2.format(a)}`;
}

/** Kwota w walucie natywnej sieci (domyślnie SOL; dla sieci EVM np. ETH). */
export function fmtSol(v: number | null | undefined, signed = false, symbol = 'SOL'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = signed && v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  const digits = a === 0 ? 2 : a < 0.001 ? 7 : a < 1 ? 5 : 3;
  return `${sign}${nf(digits, digits).format(a)} ${symbol}`;
}

/** Cena tokena: 4 cyfry znaczące, bez notacji wykładniczej. */
export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '—';
  if (v >= 1000) return nf(0, 2).format(v);
  if (v >= 1) return nf(2, 4).format(v);
  const zeros = Math.max(0, -Math.floor(Math.log10(v)) - 1);
  return v.toFixed(Math.min(14, zeros + 4));
}

export function fmtPct(v: number | null | undefined, signed = true, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = signed && v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${nf(digits, digits).format(Math.abs(v))}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return nf(0, digits).format(v);
}

export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  // małe ilości (np. drogie tokeny EVM) — cyfry znaczące zamiast zaokrąglenia do 0,1
  if (Math.abs(v) < 1000) return new Intl.NumberFormat('pl-PL', { maximumSignificantDigits: 4 }).format(v);
  return new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${r} s`;
  return `${r} s`;
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s} s temu`;
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  if (s < 86400) return `${Math.floor(s / 3600)} h temu`;
  return `${Math.floor(s / 86400)} d temu`;
}

export function shortAddr(a: string | null | undefined, n = 4): string {
  if (!a) return '—';
  return a.length > 2 * n + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export const pnlClass = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? '' : v > 0 ? 'pos' : 'neg');

export function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    'manual:buy': 'Ręczne kupno',
    'manual:sell': 'Ręczna sprzedaż',
    'manual:sell_all': 'Sprzedaj wszystko',
    'manual:stop_liquidation': 'Likwidacja przy stopie',
    'emergency:liquidation': 'Likwidacja awaryjna',
    'risk:hard_stop_during_pause': 'Twardy SL (pauza)',
    'strategy:exit:take_profit': 'Take profit',
    'strategy:exit:stop_loss': 'Stop loss',
    'strategy:exit:hard_stop_loss': 'Twardy stop loss',
    'strategy:exit:trailing_stop': 'Trailing stop',
    'strategy:exit:max_hold_time': 'Maks. czas trzymania',
  };
  if (map[reason]) return map[reason];
  if (reason.startsWith('strategy:entry:')) return `Strategia: ${reason.slice(15).replace(/_/g, ' ').toLowerCase()}`;
  if (reason.startsWith('strategy:exit:scenario_')) return `Wyjście: ${reason.slice(23).replace(/_/g, ' ').toLowerCase()}`;
  return reason;
}
