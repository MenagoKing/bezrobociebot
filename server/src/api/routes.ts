import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CALLOUT_EVENTS, type AppStateSnapshot, type SettingsSection, type Trade } from '../../../shared/types.ts';
import type { AppContext } from '../app.ts';
import { DEFAULT_SETTINGS, formatZodError } from '../config/schema.ts';
import { LIVE_CONFIRM_PHRASE } from '../coordinator/coordinator.ts';
import { UserError } from '../core/util.ts';
import { TEMPLATE_VARIABLES } from '../services/calloutService.ts';
import { WALLET_SECRETS } from '../services/accountService.ts';
import { COOKIE, isLoopback, readCookie, setSessionCookie } from './server.ts';

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
  const { auth, coordinator, repo, settings, market, stats, callouts, account, wallet, health, backup, engine, queue } = ctx;

  // ---------- auth ----------
  app.get('/api/auth/status', async (req) => ({
    authenticated: auth.validate(readCookie(req, COOKIE)),
    setupRequired: auth.isSetupRequired(),
    setupAllowed: auth.isSetupRequired() && isLoopback(req),
  }));

  app.post('/api/auth/setup', async (req, reply) => {
    if (!isLoopback(req)) throw new UserError('Pierwsze ustawienie hasła jest możliwe tylko lokalnie (lub przez ADMIN_PASSWORD w .env)', 403);
    const { password } = parse(z.object({ password: z.string() }), req.body);
    await auth.setup(password);
    const session = await auth.login(password, req.ip);
    setSessionCookie(ctx, reply, session.token, Math.floor((session.expiresAt - Date.now()) / 1000));
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    const session = await auth.login(password, req.ip);
    setSessionCookie(ctx, reply, session.token, Math.floor((session.expiresAt - Date.now()) / 1000));
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    auth.logout(readCookie(req, COOKIE));
    setSessionCookie(ctx, reply, '', 0);
    return { ok: true };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const b = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    await auth.changePassword(b.current, b.next, req.ip);
    const session = await auth.login(b.next, req.ip);
    setSessionCookie(ctx, reply, session.token, Math.floor((session.expiresAt - Date.now()) / 1000));
    return { ok: true };
  });

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
      callouts: repo.listCallouts({ limit: 100 }),
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
    const q = parse(z.object({ address: z.string().min(1), source: z.enum(['live', 'simulated']).default('live') }), req.query);
    return market.resolve(q.address, q.source);
  });

  app.post('/api/session/start', async (req) => {
    const b = parse(
      z.object({
        tokenAddress: z.string().min(1),
        mode: z.enum(['paper', 'live']),
        dataSource: z.enum(['live', 'simulated']),
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

  // ---------- callouts ----------
  app.get('/api/callouts/templates', async () => repo.listTemplates());
  app.post('/api/callouts/templates', async (req) => callouts.createTemplate(req.body));
  app.put('/api/callouts/templates/:id', async (req) => callouts.updateTemplate(parse(idParam, req.params).id, req.body));
  app.delete('/api/callouts/templates/:id', async (req) => {
    callouts.deleteTemplate(parse(idParam, req.params).id);
    return { ok: true };
  });
  app.post('/api/callouts/templates/import', async (req) => callouts.importTemplates(parse(z.object({ text: z.string().max(1_000_000) }), req.body).text));
  app.post('/api/callouts/preview', async (req) => {
    const b = parse(z.object({ body: z.string().max(1000), event: z.enum(CALLOUT_EVENTS) }), req.body);
    return callouts.preview(b.body, b.event);
  });
  app.get('/api/callouts/variables', async () => TEMPLATE_VARIABLES);
  app.get('/api/callouts', async (req) => {
    const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }), req.query);
    return repo.listCallouts({ status: q.status, limit: 300 });
  });
  app.post('/api/callouts/:id/approve', async (req) => {
    const b = parse(z.object({ body: z.string().max(1200).optional() }), req.body);
    return callouts.decide(parse(idParam, req.params).id, 'approved', b.body);
  });
  app.post('/api/callouts/:id/reject', async (req) => callouts.decide(parse(idParam, req.params).id, 'rejected'));

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
    const { password } = parse(z.object({ password: z.string().optional() }), req.body);
    if (WALLET_SECRETS.includes(name)) assertNoLiveSession();
    const updated = await account.deleteSecret(name, password, req.ip);
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
        password: z.string().min(1, 'Podaj hasło administratora'),
      }),
      req.body,
    );
    assertNoLiveSession();
    const result = await account.changeWallet(input, req.ip);
    await wallet.refresh();
    return result;
  });
  app.post('/api/account/wallet-archive/:id/reveal', async (req) => {
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    return { value: await account.revealArchived(parse(idParam, req.params).id, password, req.ip) };
  });
  app.post('/api/account/wallet-archive/:id/delete', async (req) => {
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    return account.deleteArchived(parse(idParam, req.params).id, password, req.ip);
  });
  app.post('/api/account/secrets/:name/reveal', async (req: FastifyRequest) => {
    const { name } = req.params as { name: string };
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    return { value: await account.reveal(name, password, req.ip) };
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
