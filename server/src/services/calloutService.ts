import { z } from 'zod';
import { CALLOUT_EVENTS, type Callout, type CalloutEvent, type CalloutTemplate, type Position, type SessionRecord, type Trade } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import { formatZodError } from '../config/schema.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import type { EventBus } from '../core/eventBus.ts';
import { UserError } from '../core/util.ts';
import type { Repository } from '../db/repository.ts';

export const TEMPLATE_VARIABLES: Record<string, string> = {
  token_name: 'Nazwa tokena',
  symbol: 'Symbol tokena',
  token_address: 'Adres kontraktu',
  buy_price: 'Cena zakupu (USD)',
  sell_price: 'Cena sprzedaży (USD)',
  value_usd: 'Wartość transakcji (USD)',
  value_sol: 'Wartość transakcji (waluta sieci)',
  native: 'Waluta sieci (SOL / ETH…)',
  chain: 'Sieć',
  amount: 'Liczba tokenów',
  pnl_usd: 'Wynik (USD)',
  pnl_sol: 'Wynik (SOL)',
  pnl_pct: 'Wynik (%)',
  hold_time: 'Czas trzymania',
  time: 'Godzina transakcji',
  mode: 'Tryb (PAPER/LIVE)',
};

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(80),
  category: z.string().trim().min(1).max(40).default('ogólne'),
  event: z.enum(CALLOUT_EVENTS),
  body: z.string().trim().min(1, 'Treść jest wymagana').max(1000),
  enabled: z.boolean().default(true),
  weight: z.number().int().min(1).max(100).default(1),
});

const DEFAULT_TEMPLATES: Omit<CalloutTemplate, 'id' | 'createdAt'>[] = [
  { name: 'Kupno — krótkie', category: 'ogólne', event: 'buy', body: 'Kupno {symbol}: {value_usd} USD po {buy_price}.', enabled: true, weight: 1 },
  { name: 'Sprzedaż — krótkie', category: 'ogólne', event: 'sell', body: 'Sprzedaż {symbol} po {sell_price} ({value_usd} USD).', enabled: true, weight: 1 },
  { name: 'Zysk', category: 'wyniki', event: 'close_profit', body: 'Zamknięta pozycja {symbol}: +{pnl_usd} USD ({pnl_pct}) po {hold_time}.', enabled: true, weight: 1 },
  { name: 'Strata', category: 'wyniki', event: 'close_loss', body: 'Zamknięta pozycja {symbol}: {pnl_usd} USD ({pnl_pct}) po {hold_time}.', enabled: true, weight: 1 },
];

function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  if (v >= 1) return v.toFixed(4);
  const digits = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(v))));
  return v.toFixed(digits);
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') (row.push(field), (field = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

/**
 * Callout Manager: szablony ogłoszeń generowanych WYŁĄCZNIE z rzeczywiście wykonanych transakcji,
 * zawsze z etykietą treści automatycznej. Ogłoszenia trafiają do kolejki zatwierdzeń / feedu w panelu —
 * moduł niczego nie publikuje na zewnątrz.
 */
export class CalloutService {
  private repo: Repository;
  private bus: EventBus;
  private settings: SettingsService;
  private errors: ErrorMonitor;

  constructor(repo: Repository, bus: EventBus, settings: SettingsService, errors: ErrorMonitor) {
    this.repo = repo;
    this.bus = bus;
    this.settings = settings;
    this.errors = errors;
  }

  init(): void {
    if (this.repo.countTemplates() === 0) DEFAULT_TEMPLATES.forEach((t) => this.repo.createTemplate(t));
    this.bus.on('trade.executed', ({ trade, position, session }) => this.onTrade(trade, position, session));
  }

  variables(trade: Trade, position: Position, session: SessionRecord): Record<string, string> {
    const pnlUsd = position.realizedPnlUsd ?? 0;
    const pnlPct = position.costSol > 0 ? ((position.realizedPnlSol ?? 0) / position.costSol) * 100 : 0;
    const sign = (v: number) => (v > 0 ? '+' : '');
    return {
      token_name: session.tokenName,
      symbol: session.tokenSymbol,
      token_address: session.tokenAddress,
      buy_price: fmtPrice(position.entryPriceUsd),
      sell_price: position.exitPriceUsd !== null ? fmtPrice(position.exitPriceUsd) : '-',
      value_usd: trade.valueUsd.toFixed(2),
      value_sol: trade.valueSol.toFixed(6),
      native: session.nativeSymbol,
      chain: session.chain,
      amount: trade.amount.toLocaleString('pl-PL', { maximumFractionDigits: 2 }),
      pnl_usd: `${sign(pnlUsd)}${pnlUsd.toFixed(2)}`,
      pnl_sol: `${sign(pnlUsd)}${(position.realizedPnlSol ?? 0).toFixed(5)}`,
      pnl_pct: `${sign(pnlPct)}${pnlPct.toFixed(1)}%`,
      hold_time: fmtDuration(((position.closedAt ?? trade.ts) - position.openedAt) / 1000),
      time: new Date(trade.ts).toLocaleTimeString('pl-PL'),
      mode: session.mode.toUpperCase(),
    };
  }

  render(body: string, vars: Record<string, string>): { text: string; unknown: string[] } {
    const unknown: string[] = [];
    const text = body.replace(/\{(\w+)\}/g, (match, key: string) => {
      if (key in vars) return vars[key]!;
      unknown.push(key);
      return match;
    });
    return { text, unknown };
  }

  private label(text: string): string {
    const label = this.settings.get().callouts.autoLabel;
    return text.includes(label) ? text : `${text} ${label}`;
  }

  private onTrade(trade: Trade, position: Position, session: SessionRecord): void {
    const cfg = this.settings.get().callouts;
    if (!cfg.enabled) return;
    const events: CalloutEvent[] =
      trade.side === 'buy' ? ['buy'] : ['sell', (position.realizedPnlSol ?? 0) >= 0 ? 'close_profit' : 'close_loss'];
    for (const event of events) {
      try {
        const ev = cfg.events[event];
        if (!ev.enabled || Math.random() * 100 >= ev.probabilityPct) continue;
        const last = this.repo.lastCalloutAt(event);
        if (last && Date.now() - last < ev.minIntervalSec * 1000) continue;
        const templates = this.repo.listTemplates().filter((t) => t.enabled && t.event === event);
        if (!templates.length) continue;
        const total = templates.reduce((a, t) => a + t.weight, 0);
        let pick = Math.random() * total;
        const template = templates.find((t) => (pick -= t.weight) < 0) ?? templates[0]!;
        const { text } = this.render(template.body, this.variables(trade, position, session));
        const callout = this.repo.insertCallout({
          templateId: template.id,
          sessionId: session.id,
          tradeId: trade.id,
          event,
          body: this.label(text),
          status: cfg.requireApproval ? 'pending' : 'approved',
        });
        this.bus.emit('callout.updated', callout);
      } catch (err) {
        this.errors.record('callouts', err, { level: 'warn' });
      }
    }
  }

  preview(body: string, event: CalloutEvent): { text: string; unknown: string[] } {
    const now = Date.now();
    const sample: Record<string, string> = {
      token_name: 'Przykładowy Token',
      symbol: 'PRZYK',
      token_address: 'So11111111111111111111111111111111111111112',
      buy_price: '0.00004521',
      sell_price: event === 'buy' ? '-' : '0.00005013',
      value_usd: '0.85',
      value_sol: '0.005670',
      native: 'SOL',
      chain: 'solana',
      amount: '18 801,33',
      pnl_usd: event === 'close_loss' ? '-0.07' : '+0.09',
      pnl_sol: event === 'close_loss' ? '-0.00047' : '+0.00060',
      pnl_pct: event === 'close_loss' ? '-8.2%' : '+10.9%',
      hold_time: '3 min 12 s',
      time: new Date(now).toLocaleTimeString('pl-PL'),
      mode: 'PAPER',
    };
    const r = this.render(body, sample);
    return { text: this.label(r.text), unknown: r.unknown };
  }

  createTemplate(input: unknown): CalloutTemplate {
    const p = templateSchema.safeParse(input);
    if (!p.success) throw new UserError(formatZodError(p.error));
    return this.repo.createTemplate(p.data);
  }

  updateTemplate(id: number, input: unknown): CalloutTemplate {
    const existing = this.repo.getTemplate(id);
    if (!existing) throw new UserError('Szablon nie istnieje', 404);
    const p = templateSchema.safeParse({ ...existing, ...(input as object) });
    if (!p.success) throw new UserError(formatZodError(p.error));
    return this.repo.updateTemplate(id, p.data)!;
  }

  deleteTemplate(id: number): void {
    this.repo.deleteTemplate(id);
  }

  /**
   * Import hurtowy. CSV z nagłówkiem: name,category,event,body[,weight]
   * albo linie w formacie: event | category | body
   */
  importTemplates(text: string): { imported: number; skipped: number; errors: string[] } {
    const existing = new Set(this.repo.listTemplates().map((t) => `${t.event}|${t.body.trim()}`));
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;
    const lines = text.trim();
    const isPipe = !/^\s*name\s*[,;]/i.test(lines);
    const rows: { name: string; category: string; event: string; body: string; weight?: number }[] = [];
    if (isPipe) {
      lines.split(/\r?\n/).forEach((line, i) => {
        if (!line.trim() || line.trim().startsWith('#')) return;
        const parts = line.split('|').map((s) => s.trim());
        if (parts.length < 3) return errors.push(`linia ${i + 1}: oczekiwano „zdarzenie | kategoria | treść”`);
        const [event, category, ...body] = parts;
        rows.push({ name: `${event} #${i + 1}`, category: category!, event: event!, body: body.join(' | ') });
      });
    } else {
      const [header, ...data] = parseCsv(lines);
      const idx = (k: string) => header!.findIndex((h) => h.trim().toLowerCase() === k);
      const [ni, ci, ei, bi, wi] = ['name', 'category', 'event', 'body', 'weight'].map(idx);
      if (ni! < 0 || ei! < 0 || bi! < 0) return { imported: 0, skipped: 0, errors: ['CSV musi mieć kolumny: name, event, body (opcjonalnie category, weight)'] };
      data.forEach((r) =>
        rows.push({
          name: r[ni!] ?? '',
          category: ci! >= 0 ? r[ci!] || 'ogólne' : 'ogólne',
          event: (r[ei!] ?? '').trim(),
          body: r[bi!] ?? '',
          weight: wi! >= 0 && r[wi!] ? Number(r[wi!]) : undefined,
        }),
      );
    }
    rows.forEach((row, i) => {
      const p = templateSchema.safeParse({ ...row, enabled: true });
      if (!p.success) return errors.push(`wiersz ${i + 1}: ${formatZodError(p.error)}`);
      const key = `${p.data.event}|${p.data.body}`;
      if (existing.has(key)) return skipped++;
      existing.add(key);
      this.repo.createTemplate(p.data);
      imported++;
    });
    return { imported, skipped, errors };
  }

  decide(id: number, status: 'approved' | 'rejected', body?: string): Callout {
    const c = this.repo.getCallout(id);
    if (!c) throw new UserError('Ogłoszenie nie istnieje', 404);
    const finalBody = body !== undefined ? this.label(body.trim()) : undefined;
    const updated = this.repo.setCalloutStatus(id, status, finalBody)!;
    this.bus.emit('callout.updated', updated);
    return updated;
  }
}
