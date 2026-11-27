import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type AppStateSnapshot, type SettingsSection, type Trade } from '../../../shared/types.ts';
import type { AppContext } from '../app.ts';
import { DEFAULT_SETTINGS, formatZodError } from '../config/schema.ts';
import { LIVE_CONFIRM_PHRASE } from '../coordinator/coordinator.ts';
import { openExternal } from '../core/openExternal.ts';
import { CHART_TFS } from '../market/chartCandles.ts';
import { UserError } from '../core/util.ts';
import { WALLET_SECRETS } from '../services/accountService.ts';

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new UserError(formatZodError(r.error));
  return r.data;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });
const SECTIONS = Object.keys(DEFAULT_SETTINGS) as SettingsSection[];

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tradesCsv(trades: Trade[]): string {
  const cols: (keyof Trade)[] = ['id', 'ts', 'side', 'tokenSymbol', 'amount', 'priceSol', 'priceUsd', 'valueSol', 'valueUsd', 'feeSol', 'networkFeeSol', 'solUsd', 'mode', 'reason', 'txSignature'];
  const rows = [...trades].reverse().map((t) => cols.map((c) => (c === 'ts' ? new Date(t.ts).toISOString() : csvEscape(t[c]))).join(','));
  return [cols.join(','), ...rows].join('\n');
}

/** Identyfikator zbudowanego panelu — pozwala otwartej karcie wykryć, że serwer ma nowszą wersję. */
function panelBuildId(webDist: string): string {
  const index = path.join(webDist, 'index.html');
  return fs.existsSync(index) ? createHash('sha1').update(fs.readFileSync(index)).digest('hex').slice(0, 12) : 'dev';
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const buildId = panelBuildId(ctx.env.webDist);
  const { coordinator, repo, settings, market, stats, account, wallet, health, backup, engine, queue } = ctx;

  app.get('/api/health', async () => ({ ok: true, uptimeSec: Math.round(process.uptime()) }));

  // ---------- stan ----------
  const snapshotState = (): AppStateSnapshot & { meta: Record<string, unknown> } => {
    const session = coordinator.activeSession();
    const solUsd = market.solUsdNow();
    return {
      bot: engine.snapshot(),
      session,
      token: session ? repo.getSessionToken(session.id) : null,
      market: { snapshot: market.snapshot, analysis: market.analysis, candles: market.candles(), feed: market.feed },
      positions: session ? stats.withMarks(repo.listOpenPositions(session.id), market.snapshot?.priceSol, solUsd) : [],
      trades: repo.listTrades({ limit: 100 }),
      orders: session ? repo.listOrders({ sessionId: session.id, limit: 50 }) : [],
      stats: coordinator.currentStats(),
      wallet: wallet.state,
      health: health.current,
      settings: settings.get(),
      meta: { liveTradingEnabled: ctx.env.liveTradingEnabled, liveConfirmPhrase: LIVE_CONFIRM_PHRASE, version: '0.1.0', buildId },
    };
  };
  app.get('/api/state', async () => snapshotState());

  // ---------- token / sesja ----------
  app.get('/api/token/resolve', async (req) => {
    const q = parse(z.object({ address: z.string().min(1), source: z.enum(['live']).default('live') }), req.query);
    return market.resolve(q.address, q.source);
  });
  app.get('/api/token/search', async (req) => {
    const q = parse(z.object({ q: z.string().trim().min(2).max(80) }), req.query);
    return market.search(q.q);
  });
  app.get('/api/token/preview', async (req) => {
    const q = parse(z.object({ address: z.string().min(1), source: z.enum(['live']).default('live') }), req.query);
    return market.preview(q.address, q.source);
  });

  // linki do pump.fun / GMGN / eksploratorów otwierane w przeglądarce systemu, nie w panelu
  app.post('/api/open-external', async (req) => {
    const b = parse(z.object({ url: z.string().url().max(2000) }), req.body);
    const u = new URL(b.url);
    if (u.protocol !== 'https:') throw new UserError('Można otwierać tylko linki https');
    await openExternal(u.toString());
    return { ok: true };
  });

  app.get('/api/token/candles', async (req) => {
    const q = parse(
      z.object({ address: z.string().min(1), tf: z.coerce.number().int().refine((v) => (CHART_TFS as readonly number[]).includes(v), 'nieobsługiwany interwał') }),
      req.query,
    );
    return market.chartCandles(q.address, q.tf);
  });

  app.post('/api/session/start', async (req) => {
    const b = parse(
      z.object({
        tokenAddress: z.string().min(1),
        mode: z.enum(['paper', 'live']),
        // aplikacja produkcyjna: tylko prawdziwe dane rynkowe (symulator rynku służy wyłącznie testom automatycznym)
        dataSource: z.enum(['live']).default('live'),
        startingCapitalUsd: z.number().positive().optional(),
        confirmPhrase: z.string().optional(),
      }),
      req.body,
    );
    return coordinator.startSession(b);
  });
  app.post('/api/session/pause', async () => coordinator.pause('ręcznie z panelu'));
  app.post('/api/session/resume', async () => coordinator.resume());
  app.post('/api/session/stop', async (req) => {
    const b = parse(z.object({ liquidate: z.boolean().default(true) }), req.body);
    return coordinator.stop(b);
  });
  app.post('/api/session/emergency-stop', async () => coordinator.emergencyStop());

  app.post('/api/commands/buy', async (req) => coordinator.manualBuy(parse(z.object({ usd: z.number().positive() }), req.body).usd));
  app.post('/api/commands/sell', async (req) =>
    coordinator.manualSell(parse(z.object({ positionId: z.number().int().positive() }), req.body).positionId),
  );
  app.post('/api/commands/sell-all', async () => coordinator.sellAll());

  // ---------- ustawienia i presety ----------
  app.get('/api/settings', async () => settings.get());
  app.put('/api/settings/:section', async (req) => {
    const { section } = req.params as { section: SettingsSection };
    if (!SECTIONS.includes(section)) throw new UserError('Nieznana sekcja', 404);
    const updated = settings.update(section, req.body);
    if (section === 'analysis') market.reanalyze();
    return updated;
  });
  app.post('/api/settings/:section/reset', async (req) => {
    const { section } = req.params as { section: SettingsSection };
    if (!SECTIONS.includes(section)) throw new UserError('Nieznana sekcja', 404);
    return settings.update(section, structuredClone(DEFAULT_SETTINGS[section]));
  });

  app.get('/api/presets', async (req) => {
    const q = parse(z.object({ kind: z.enum(['trading', 'analysis']).optional() }), req.query);
    return repo.listPresets(q.kind);
  });
  app.post('/api/presets', async (req) => {
    const b = parse(z.object({ kind: z.enum(['trading', 'analysis']), name: z.string().trim().min(1).max(60) }), req.body);
    const s = settings.get();
    const data = b.kind === 'trading' ? { trading: s.trading, risk: s.risk } : { analysis: s.analysis };
    const id = repo.upsertPreset(b.kind, b.name, data);
    return repo.getPreset(id);
  });
  app.post('/api/presets/:id/apply', async (req) => {
    const { id } = parse(idParam, req.params);
    const preset = repo.getPreset(id);
    if (!preset) throw new UserError('Preset nie istnieje', 404);
    const data = preset.data as Partial<Record<SettingsSection, unknown>>;
    for (const section of ['trading', 'risk', 'analysis'] as const) {
      if (data[section]) settings.update(section, data[section]);
    }
    if (data.analysis) market.reanalyze();
    return settings.get();
  });
  app.delete('/api/presets/:id', async (req) => {
    repo.deletePreset(parse(idParam, req.params).id);
    return { ok: true };
  });

  // ---------- rynek ----------
  app.get('/api/market', async () => ({ token: market.token, snapshot: market.snapshot, analysis: market.analysis, candles: market.candles(), feed: market.feed }));
  app.post('/api/market/reanalyze', async () => market.reanalyze());

  // ---------- dane handlowe ----------
  app.get('/api/positions', async (req) => {
    const q = parse(z.object({ sessionId: z.coerce.number().int().optional(), status: z.enum(['open', 'closed', 'all']).default('all') }), req.query);
    const sessionId = q.sessionId ?? coordinator.activeSession()?.id ?? repo.listSessions(1)[0]?.id;
    if (!sessionId) return [];
    const list = repo.listPositions(sessionId).filter((p) => q.status === 'all' || p.status === q.status);
    const live = coordinator.activeSession()?.id === sessionId;
    return live ? stats.withMarks(list, market.snapshot?.priceSol, market.solUsdNow()) : list;
  });
  app.get('/api/trades', async (req) => {
    const q = parse(z.object({ sessionId: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(10000).default(500) }), req.query);
    return repo.listTrades({ sessionId: q.sessionId, limit: q.limit });
  });
  app.get('/api/orders', async (req) => {
    const q = parse(z.object({ sessionId: z.coerce.number().int().optional() }), req.query);
    return repo.listOrders({ sessionId: q.sessionId ?? coordinator.activeSession()?.id, limit: 200 });
  });

  app.get('/api/sessions', async () => repo.listSessions(200));
  app.get('/api/sessions/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const session = repo.getSession(id);
    if (!session) throw new UserError('Sesja nie istnieje', 404);
    const active = coordinator.activeSession()?.id === id;
    return {
      session,
      token: repo.getSessionToken(id),
      config: repo.getSessionConfig(id),
      stats: active ? coordinator.currentStats() : (session.summary ?? stats.compute(session)),
      positions: repo.listPositions(id),
      trades: repo.listTrades({ sessionId: id, limit: 2000 }),
      equity: repo.listEquity(id),
    };
  });
  app.get('/api/sessions/:id/export', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { format } = parse(z.object({ format: z.enum(['csv', 'json']).default('json') }), req.query);
    const session = repo.getSession(id);
    if (!session) throw new UserError('Sesja nie istnieje', 404);
    const trades = repo.listTrades({ sessionId: id, limit: 1_000_000 });
    if (format === 'csv') {
      reply.header('content-disposition', `attachment; filename="soldesk-session-${id}-trades.csv"`);
      return reply.type('text/csv; charset=utf-8').send('﻿' + tradesCsv(trades));
    }
    const active = coordinator.activeSession()?.id === id;
    reply.header('content-disposition', `attachment; filename="soldesk-session-${id}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      session,
      token: repo.getSessionToken(id),
      stats: active ? coordinator.currentStats() : (session.summary ?? stats.compute(session)),
      config: repo.getSessionConfig(id),
      positions: repo.listPositions(id),
      trades,
      equity: repo.listEquity(id, 5000),
    };
  });
  app.get('/api/stats/current', async () => coordinator.currentStats());


  // ---------- konto i portfel ----------
  app.get('/api/account', async () => account.get());
  app.put('/api/account', async (req) => {
    const updated = account.update(req.body);
    void wallet.refresh();
    return updated;
  });
  app.put('/api/account/secrets/:name', async (req) => {
    const { name } = req.params as { name: string };
    const updated = account.setSecret(name, parse(z.object({ value: z.string().max(4096) }), req.body).value);
    void wallet.refresh();
    return updated;
  });
  const assertNoLiveSession = () => {
    if (coordinator.activeSession()?.mode === 'live') throw new UserError('Najpierw zakończ sesję live — portfel jest w użyciu', 409);
  };
  app.post('/api/account/secrets/:name/delete', async (req) => {
    const { name } = req.params as { name: string };
    if (WALLET_SECRETS.includes(name)) assertNoLiveSession();
    const updated = await account.deleteSecret(name);
    void wallet.refresh();
    return updated;
  });
  app.post('/api/account/generate-wallet', async (req) => {
    const { kind } = parse(z.object({ kind: z.enum(['solana', 'evm']) }), req.body);
    assertNoLiveSession();
    const result = account.generateWallet(kind);
    void wallet.refresh();
    return result;
  });
  app.post('/api/account/change-wallet', async (req) => {
    const input = parse(
      z.object({
        kind: z.enum(['solana', 'evm']),
        source: z.enum(['generate', 'import', 'archive']),
        privateKey: z.string().max(4096).optional(),
        archiveId: z.number().int().positive().optional(),
      }),
      req.body,
    );
    assertNoLiveSession();
    const result = await account.changeWallet(input);
    await wallet.refresh();
    return result;
  });
  app.post('/api/account/wallet-archive/:id/reveal', async (req) => {
    return { value: await account.revealArchived(parse(idParam, req.params).id) };
  });
  app.post('/api/account/wallet-archive/:id/delete', async (req) => {
    return account.deleteArchived(parse(idParam, req.params).id);
  });
  // dodatkowe portfele handlowe — zmiany zbioru portfeli tylko poza sesją live (kapitał sesji = suma ich sald)
  app.post('/api/account/trading-wallets', async (req) => {
    const input = parse(
      z.object({
        kind: z.enum(['solana', 'evm']),
        source: z.enum(['generate', 'import']),
        privateKey: z.string().max(4096).optional(),
        label: z.string().max(40).optional(),
      }),
      req.body,
    );
    assertNoLiveSession();
    const result = account.addTradingWallet(input);
    await wallet.refresh();
    return result;
  });
  app.post('/api/account/trading-wallets/:id', async (req) => {
    const patch = parse(z.object({ label: z.string().max(40).optional(), enabled: z.boolean().optional() }), req.body);
    if (patch.enabled !== undefined) assertNoLiveSession();
    const updated = account.updateTradingWallet(parse(idParam, req.params).id, patch);
    void wallet.refresh();
    return updated;
  });
  app.post('/api/account/trading-wallets/:id/reveal', async (req) => {
    return { value: await account.revealTradingWallet(parse(idParam, req.params).id) };
  });
  app.post('/api/account/trading-wallets/:id/delete', async (req) => {
    assertNoLiveSession();
    const updated = await account.removeTradingWallet(parse(idParam, req.params).id);
    void wallet.refresh();
    return updated;
  });
  app.post('/api/account/secrets/:name/reveal', async (req: FastifyRequest) => {
    const { name } = req.params as { name: string };
    return { value: await account.reveal(name) };
  });
  app.post('/api/account/check', async () => account.checkStatus(ctx.rpc));
  app.get('/api/wallet', async () => wallet.state);
  app.post('/api/wallet/refresh', async () => {
    await wallet.refresh();
    return wallet.state;
  });

  // ---------- system ----------
  app.get('/api/system/health', async () => health.current);
  app.get('/api/system/errors', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(2000).default(300) }), req.query);
    return repo.listErrors(q.limit);
  });
  app.post('/api/system/errors/ack', async () => {
    repo.acknowledgeErrors();
    return { ok: true };
  });
  app.post('/api/system/backup', async () => backup.backupNow());
  app.get('/api/system/backups', async () => backup.list());
  app.get('/api/system/queue', async () => ({ active: repo.countActiveOrders(), orders: queue.activeOrders(coordinator.activeSession()?.id ?? -1) }));
}
