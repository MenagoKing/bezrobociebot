import type {
  AccountProfile,
  ArchivedWallet,
  Callout,
  CalloutEvent,
  CalloutTemplate,
  DataSource,
  EquityPoint,
  ErrorEntry,
  ExecutionMode,
  Order,
  OrderSide,
  OrderStatus,
  Platform,
  Position,
  Preset,
  SessionRecord,
  SessionStats,
  SessionStatus,
  TokenInfo,
  Trade,
  TradingWallet,
  WalletKind,
} from '../../../shared/types.ts';
import type { Db } from './database.ts';

type Row = Record<string, unknown>;
const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const parseJson = <T>(v: unknown): T | null => (typeof v === 'string' && v ? (JSON.parse(v) as T) : null);

const ACTIVE_STATUSES = "('running','paused','stopping')";

function mapSession(r: Row): SessionRecord {
  return {
    id: Number(r.id),
    chain: String(r.chain ?? 'solana'),
    nativeSymbol: String(r.native_symbol ?? 'SOL'),
    tokenAddress: String(r.token_address),
    tokenName: String(r.token_name),
    tokenSymbol: String(r.token_symbol),
    pairAddress: String(r.pair_address),
    mode: r.mode as ExecutionMode,
    dataSource: r.data_source as DataSource,
    status: r.status as SessionStatus,
    startedAt: Number(r.started_at),
    endedAt: n(r.ended_at),
    startCapitalSol: Number(r.start_capital_sol),
    startCapitalUsd: Number(r.start_capital_usd),
    startSolUsd: Number(r.start_sol_usd),
    paperBalanceSol: Number(r.paper_balance_sol),
    rentPaidSol: Number(r.rent_paid_sol),
    summary: parseJson<SessionStats>(r.summary),
  };
}

function mapTradingWallet(r: Row): TradingWallet {
  return {
    id: Number(r.id),
    kind: r.kind as WalletKind,
    label: String(r.label),
    address: String(r.address),
    enabled: Number(r.enabled) === 1,
    createdAt: Number(r.created_at),
  };
}

function mapPosition(r: Row): Position {
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    walletId: Number(r.wallet_id ?? 0),
    status: r.status as Position['status'],
    openedAt: Number(r.opened_at),
    closedAt: n(r.closed_at),
    amount: Number(r.amount),
    decimals: Number(r.decimals),
    entryPriceSol: Number(r.entry_price_sol),
    entryPriceUsd: Number(r.entry_price_usd),
    costSol: Number(r.cost_sol),
    peakPriceSol: Number(r.peak_price_sol),
    exitPriceSol: n(r.exit_price_sol),
    exitPriceUsd: n(r.exit_price_usd),
    proceedsSol: n(r.proceeds_sol),
    realizedPnlSol: n(r.realized_pnl_sol),
    realizedPnlUsd: n(r.realized_pnl_usd),
    feesSol: Number(r.fees_sol),
    exitReason: s(r.exit_reason),
  };
}

function mapTrade(r: Row): Trade {
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    positionId: Number(r.position_id),
    side: r.side as OrderSide,
    ts: Number(r.ts),
    priceSol: Number(r.price_sol),
    priceUsd: Number(r.price_usd),
    amount: Number(r.amount),
    valueSol: Number(r.value_sol),
    valueUsd: Number(r.value_usd),
    feeSol: Number(r.fee_sol),
    networkFeeSol: Number(r.network_fee_sol),
    solUsd: Number(r.sol_usd),
    txSignature: s(r.tx_signature),
    mode: r.mode as ExecutionMode,
    reason: String(r.reason),
    tokenSymbol: r.token_symbol ? String(r.token_symbol) : undefined,
    chain: r.chain ? String(r.chain) : undefined,
    nativeSymbol: r.native_symbol ? String(r.native_symbol) : undefined,
  };
}

function mapOrder(r: Row): Order {
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    walletId: Number(r.wallet_id ?? 0),
    side: r.side as OrderSide,
    valueSol: n(r.value_sol),
    positionId: n(r.position_id),
    reason: String(r.reason),
    status: r.status as OrderStatus,
    attempts: Number(r.attempts),
    error: s(r.error),
    txSignature: s(r.tx_signature),
    tradeId: n(r.trade_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function mapTemplate(r: Row): CalloutTemplate {
  return {
    id: Number(r.id),
    name: String(r.name),
    category: String(r.category),
    event: r.event as CalloutEvent,
    body: String(r.body),
    enabled: Number(r.enabled) === 1,
    weight: Number(r.weight),
    createdAt: Number(r.created_at),
  };
}

function mapCallout(r: Row): Callout {
  return {
    id: Number(r.id),
    templateId: n(r.template_id),
    sessionId: n(r.session_id),
    tradeId: n(r.trade_id),
    event: r.event as CalloutEvent,
    body: String(r.body),
    status: r.status as Callout['status'],
    createdAt: Number(r.created_at),
    decidedAt: n(r.decided_at),
  };
}

function mapError(r: Row): ErrorEntry {
  return {
    id: Number(r.id),
    ts: Number(r.ts),
    level: r.level as ErrorEntry['level'],
    source: String(r.source),
    message: String(r.message),
    context: parseJson<Record<string, unknown>>(r.context),
    acknowledged: Number(r.acknowledged) === 1,
  };
}

export class Repository {
  readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  private update(table: string, id: number, fields: Record<string, unknown>, allowed: string[]): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || !allowed.includes(key)) continue;
      sets.push(`${toSnake(key)} = ?`);
      vals.push(value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
    }
    if (!sets.length) return;
    this.db.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...(vals as never[]), id);
  }

  // ---------- settings / presets / meta ----------
  getSettingsRaw(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.db.all<Row>('SELECT section, data FROM settings')) {
      out[String(r.section)] = JSON.parse(String(r.data));
    }
    return out;
  }

  saveSettings(section: string, data: unknown): void {
    this.db.run(
      `INSERT INTO settings (section, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(section) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      section,
      JSON.stringify(data),
      Date.now(),
    );
  }

  listPresets(kind?: Preset['kind']): Preset[] {
    const rows = kind
      ? this.db.all<Row>('SELECT * FROM presets WHERE kind = ? ORDER BY name', kind)
      : this.db.all<Row>('SELECT * FROM presets ORDER BY kind, name');
    return rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind as Preset['kind'],
      name: String(r.name),
      data: JSON.parse(String(r.data)),
      createdAt: Number(r.created_at),
    }));
  }

  getPreset(id: number): Preset | null {
    return this.listPresets().find((p) => p.id === id) ?? null;
  }

  upsertPreset(kind: Preset['kind'], name: string, data: unknown): number {
    this.db.run(
      `INSERT INTO presets (kind, name, data, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, name) DO UPDATE SET data = excluded.data`,
      kind,
      name,
      JSON.stringify(data),
      Date.now(),
    );
    return Number(this.db.get<Row>('SELECT id FROM presets WHERE kind = ? AND name = ?', kind, name)!.id);
  }

  deletePreset(id: number): void {
    this.db.run('DELETE FROM presets WHERE id = ?', id);
  }

  getMeta(key: string): string | null {
    return s(this.db.get<Row>('SELECT value FROM meta WHERE key = ?', key)?.value);
  }

  setMeta(key: string, value: string): void {
    this.db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  // ---------- account / secrets ----------
  getAccount(): AccountProfile {
    const r = this.db.get<Row>('SELECT * FROM account WHERE id = 1')!;
    return {
      name: String(r.name),
      email: String(r.email),
      platform: r.platform as Platform,
      walletAddress: String(r.wallet_address),
      evmWalletAddress: String(r.evm_wallet_address ?? ''),
    };
  }

  saveAccount(a: AccountProfile): void {
    this.db.run(
      'UPDATE account SET name = ?, email = ?, platform = ?, wallet_address = ?, evm_wallet_address = ?, updated_at = ? WHERE id = 1',
      a.name,
      a.email,
      a.platform,
      a.walletAddress,
      a.evmWalletAddress,
      Date.now(),
    );
  }

  getSecret(name: string): string | null {
    return s(this.db.get<Row>('SELECT ciphertext FROM secrets WHERE name = ?', name)?.ciphertext);
  }

  setSecret(name: string, ciphertext: string): void {
    this.db.run(
      `INSERT INTO secrets (name, ciphertext, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      name,
      ciphertext,
      Date.now(),
    );
  }

  deleteSecret(name: string): void {
    this.db.run('DELETE FROM secrets WHERE name = ?', name);
  }

  /** Kilka zapisów atomowo (np. zamiana portfela bota razem z archiwizacją starego klucza). */
  tx<T>(fn: () => T): T {
    return this.db.tx(fn);
  }

  // ---------- archiwum portfeli ----------
  archiveWallet(kind: WalletKind, address: string, ciphertext: string): number {
    const r = this.db.run('INSERT INTO wallet_archive (kind, address, ciphertext, archived_at) VALUES (?, ?, ?, ?)', kind, address, ciphertext, Date.now());
    return Number(r.lastInsertRowid);
  }

  listArchivedWallets(): ArchivedWallet[] {
    return this.db
      .all<Row>('SELECT id, kind, address, archived_at FROM wallet_archive ORDER BY archived_at DESC, id DESC')
      .map((r) => ({ id: Number(r.id), kind: r.kind as WalletKind, address: String(r.address), archivedAt: Number(r.archived_at) }));
  }

  getArchivedWallet(id: number): (ArchivedWallet & { ciphertext: string }) | null {
    const r = this.db.get<Row>('SELECT * FROM wallet_archive WHERE id = ?', id);
    return r ? { id: Number(r.id), kind: r.kind as WalletKind, address: String(r.address), archivedAt: Number(r.archived_at), ciphertext: String(r.ciphertext) } : null;
  }

  deleteArchivedWallet(id: number): void {
    this.db.run('DELETE FROM wallet_archive WHERE id = ?', id);
  }

  deleteArchivedWalletByAddress(kind: WalletKind, address: string): void {
    this.db.run('DELETE FROM wallet_archive WHERE kind = ? AND lower(address) = lower(?)', kind, address);
  }

  // ---------- dodatkowe portfele handlowe ----------
  createTradingWallet(w: { kind: WalletKind; label: string; address: string; ciphertext: string }): TradingWallet {
    const r = this.db.run(
      'INSERT INTO trading_wallets (kind, label, address, ciphertext, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      w.kind,
      w.label,
      w.address,
      w.ciphertext,
      Date.now(),
    );
    return this.getTradingWallet(Number(r.lastInsertRowid))!;
  }

  listTradingWallets(kind?: WalletKind): TradingWallet[] {
    const rows = kind
      ? this.db.all<Row>('SELECT * FROM trading_wallets WHERE kind = ? ORDER BY id', kind)
      : this.db.all<Row>('SELECT * FROM trading_wallets ORDER BY id');
    return rows.map(mapTradingWallet);
  }

  getTradingWallet(id: number): TradingWallet | null {
    const r = this.db.get<Row>('SELECT * FROM trading_wallets WHERE id = ?', id);
    return r ? mapTradingWallet(r) : null;
  }

  getTradingWalletCiphertext(id: number): string | null {
    return s(this.db.get<Row>('SELECT ciphertext FROM trading_wallets WHERE id = ?', id)?.ciphertext);
  }

  findTradingWalletByAddress(kind: WalletKind, address: string): TradingWallet | null {
    const r = this.db.get<Row>('SELECT * FROM trading_wallets WHERE kind = ? AND lower(address) = lower(?)', kind, address);
    return r ? mapTradingWallet(r) : null;
  }

  updateTradingWallet(id: number, f: { label?: string; enabled?: boolean }): void {
    if (f.label !== undefined) this.db.run('UPDATE trading_wallets SET label = ? WHERE id = ?', f.label, id);
    if (f.enabled !== undefined) this.db.run('UPDATE trading_wallets SET enabled = ? WHERE id = ?', f.enabled ? 1 : 0, id);
  }

  deleteTradingWallet(id: number): void {
    this.db.run('DELETE FROM trading_wallets WHERE id = ?', id);
  }

  /** Otwarte pozycje na portfelu we wszystkich aktywnych sesjach (blokuje usunięcie portfela). */
  countOpenPositionsOnWallet(walletId: number): number {
    return Number(
      this.db.get<Row>(
        `SELECT COUNT(*) AS c FROM positions p JOIN sessions s ON s.id = p.session_id
         WHERE p.wallet_id = ? AND p.status = 'open' AND s.status IN ${ACTIVE_STATUSES}`,
        walletId,
      )!.c,
    );
  }

  /** Czy portfel miał już pozycję w sesji (na Solanie pierwszy zakup tworzy konto tokena = rent). */
  walletHasPosition(sessionId: number, walletId: number): boolean {
    return !!this.db.get<Row>('SELECT 1 AS x FROM positions WHERE session_id = ? AND wallet_id = ? LIMIT 1', sessionId, walletId);
  }

  listSecretMeta(): { name: string; updatedAt: number }[] {
    return this.db
      .all<Row>('SELECT name, updated_at FROM secrets')
      .map((r) => ({ name: String(r.name), updatedAt: Number(r.updated_at) }));
  }

  // ---------- sessions ----------
  createSession(d: {
    token: TokenInfo;
    mode: ExecutionMode;
    dataSource: DataSource;
    startCapitalSol: number;
    startCapitalUsd: number;
    startSolUsd: number;
    paperBalanceSol: number;
    configSnapshot: unknown;
  }): SessionRecord {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO sessions (chain, native_symbol, token_address, token_name, token_symbol, pair_address, token_json, mode, data_source,
        status, started_at, start_capital_sol, start_capital_usd, start_sol_usd, paper_balance_sol, config_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
      d.token.chain,
      d.token.nativeSymbol,
      d.token.address,
      d.token.name,
      d.token.symbol,
      d.token.pairAddress,
      JSON.stringify(d.token),
      d.mode,
      d.dataSource,
      Date.now(),
      d.startCapitalSol,
      d.startCapitalUsd,
      d.startSolUsd,
      d.paperBalanceSol,
      JSON.stringify(d.configSnapshot),
    );
    return this.getSession(lastInsertRowid)!;
  }

  getSession(id: number): SessionRecord | null {
    const r = this.db.get<Row>('SELECT * FROM sessions WHERE id = ?', id);
    return r ? mapSession(r) : null;
  }

  getSessionToken(id: number): TokenInfo | null {
    const token = parseJson<TokenInfo>(this.db.get<Row>('SELECT token_json FROM sessions WHERE id = ?', id)?.token_json);
    // sesje sprzed obsługi wielu sieci nie mają pola chain
    return token ? { ...token, chain: token.chain ?? 'solana', nativeSymbol: token.nativeSymbol ?? 'SOL' } : null;
  }

  getSessionConfig(id: number): unknown {
    return parseJson(this.db.get<Row>('SELECT config_snapshot FROM sessions WHERE id = ?', id)?.config_snapshot);
  }

  getActiveSession(): SessionRecord | null {
    const r = this.db.get<Row>(`SELECT * FROM sessions WHERE status IN ${ACTIVE_STATUSES} ORDER BY id DESC LIMIT 1`);
    return r ? mapSession(r) : null;
  }

  updateSession(id: number, f: Partial<SessionRecord>): SessionRecord {
    this.update('sessions', id, f as Record<string, unknown>, [
      'status',
      'endedAt',
      'paperBalanceSol',
      'rentPaidSol',
      'summary',
    ]);
    return this.getSession(id)!;
  }

  listSessions(limit = 100): SessionRecord[] {
    return this.db.all<Row>('SELECT * FROM sessions ORDER BY id DESC LIMIT ?', limit).map(mapSession);
  }

  // ---------- positions ----------
  createPosition(p: Omit<Position, 'id' | 'closedAt' | 'exitPriceSol' | 'exitPriceUsd' | 'proceedsSol' | 'realizedPnlSol' | 'realizedPnlUsd' | 'exitReason' | 'status'>): Position {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO positions (session_id, wallet_id, status, opened_at, amount, decimals, entry_price_sol, entry_price_usd,
        cost_sol, peak_price_sol, fees_sol) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.sessionId,
      p.walletId,
      p.openedAt,
      p.amount,
      p.decimals,
      p.entryPriceSol,
      p.entryPriceUsd,
      p.costSol,
      p.peakPriceSol,
      p.feesSol,
    );
    return this.getPosition(lastInsertRowid)!;
  }

  getPosition(id: number): Position | null {
    const r = this.db.get<Row>('SELECT * FROM positions WHERE id = ?', id);
    return r ? mapPosition(r) : null;
  }

  listOpenPositions(sessionId: number): Position[] {
    return this.db
      .all<Row>("SELECT * FROM positions WHERE session_id = ? AND status = 'open' ORDER BY id", sessionId)
      .map(mapPosition);
  }

  listPositions(sessionId: number): Position[] {
    return this.db.all<Row>('SELECT * FROM positions WHERE session_id = ? ORDER BY id DESC', sessionId).map(mapPosition);
  }

  updatePosition(id: number, f: Partial<Position>): Position {
    this.update('positions', id, f as Record<string, unknown>, [
      'status',
      'closedAt',
      'amount',
      'peakPriceSol',
      'exitPriceSol',
      'exitPriceUsd',
      'proceedsSol',
      'realizedPnlSol',
      'realizedPnlUsd',
      'feesSol',
      'exitReason',
    ]);
    return this.getPosition(id)!;
  }

  // ---------- trades ----------
  insertTrade(t: Omit<Trade, 'id' | 'tokenSymbol'>): Trade {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO trades (session_id, position_id, side, ts, price_sol, price_usd, amount, value_sol, value_usd,
        fee_sol, network_fee_sol, sol_usd, tx_signature, mode, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.sessionId,
      t.positionId,
      t.side,
      t.ts,
      t.priceSol,
      t.priceUsd,
      t.amount,
      t.valueSol,
      t.valueUsd,
      t.feeSol,
      t.networkFeeSol,
      t.solUsd,
      t.txSignature,
      t.mode,
      t.reason,
    );
    return this.listTrades({ id: lastInsertRowid })[0]!;
  }

  listTrades(q: { sessionId?: number; id?: number; limit?: number; since?: number } = {}): Trade[] {
    const where: string[] = [];
    const params: (number | string)[] = [];
    if (q.id !== undefined) (where.push('t.id = ?'), params.push(q.id));
    if (q.sessionId !== undefined) (where.push('t.session_id = ?'), params.push(q.sessionId));
    if (q.since !== undefined) (where.push('t.ts >= ?'), params.push(q.since));
    const sql = `SELECT t.*, s.token_symbol, s.chain, s.native_symbol FROM trades t JOIN sessions s ON s.id = t.session_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT ?`;
    return this.db.all<Row>(sql, ...params, q.limit ?? 500).map(mapTrade);
  }

  countTrades(sessionId: number, since = 0): number {
    return Number(
      this.db.get<Row>('SELECT COUNT(*) AS c FROM trades WHERE session_id = ? AND ts >= ?', sessionId, since)!.c,
    );
  }

  // ---------- orders ----------
  createOrder(o: {
    sessionId: number;
    walletId: number;
    side: OrderSide;
    valueSol: number | null;
    positionId: number | null;
    reason: string;
    priority?: number;
  }): Order {
    const now = Date.now();
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO orders (session_id, wallet_id, side, value_sol, position_id, reason, priority, status, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      o.sessionId,
      o.walletId,
      o.side,
      o.valueSol,
      o.positionId,
      o.reason,
      o.priority ?? 0,
      now,
      now,
      now,
    );
    return this.getOrder(lastInsertRowid)!;
  }

  getOrder(id: number): Order | null {
    const r = this.db.get<Row>('SELECT * FROM orders WHERE id = ?', id);
    return r ? mapOrder(r) : null;
  }

  updateOrder(id: number, f: Partial<Order> & { nextAttemptAt?: number }): Order {
    this.update('orders', id, { ...f, updatedAt: Date.now() }, [
      'status',
      'attempts',
      'error',
      'txSignature',
      'tradeId',
      'nextAttemptAt',
      'updatedAt',
    ]);
    return this.getOrder(id)!;
  }

  nextPendingOrder(now: number): Order | null {
    const r = this.db.get<Row>(
      "SELECT * FROM orders WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY priority DESC, id LIMIT 1",
      now,
    );
    return r ? mapOrder(r) : null;
  }

  nextPendingAttemptAt(): number | null {
    return n(this.db.get<Row>("SELECT MIN(next_attempt_at) AS t FROM orders WHERE status = 'pending'")?.t);
  }

  listOrders(q: { sessionId?: number; statuses?: OrderStatus[]; limit?: number } = {}): Order[] {
    const where: string[] = [];
    const params: (number | string)[] = [];
    if (q.sessionId !== undefined) (where.push('session_id = ?'), params.push(q.sessionId));
    if (q.statuses?.length) {
      where.push(`status IN (${q.statuses.map(() => '?').join(',')})`);
      params.push(...q.statuses);
    }
    const sql = `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    return this.db.all<Row>(sql, ...params, q.limit ?? 100).map(mapOrder);
  }

  countActiveOrders(): number {
    return Number(this.db.get<Row>("SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','executing')")!.c);
  }

  // ---------- equity ----------
  insertEquity(sessionId: number, p: EquityPoint & { solUsd: number }): void {
    this.db.run(
      `INSERT INTO equity_snapshots (session_id, ts, balance_sol, positions_value_sol, equity_sol, equity_usd, sol_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      p.ts,
      p.balanceSol,
      p.positionsValueSol,
      p.equitySol,
      p.equityUsd,
      p.solUsd,
    );
  }

  listEquity(sessionId: number, maxPoints = 600): EquityPoint[] {
    const rows = this.db.all<Row>('SELECT * FROM equity_snapshots WHERE session_id = ? ORDER BY ts', sessionId);
    const step = Math.max(1, Math.ceil(rows.length / maxPoints));
    const picked = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    return picked.map((r) => ({
      ts: Number(r.ts),
      balanceSol: Number(r.balance_sol),
      positionsValueSol: Number(r.positions_value_sol),
      equitySol: Number(r.equity_sol),
      equityUsd: Number(r.equity_usd),
    }));
  }

  // ---------- callouts ----------
  listTemplates(): CalloutTemplate[] {
    return this.db.all<Row>('SELECT * FROM callout_templates ORDER BY category, name').map(mapTemplate);
  }

  getTemplate(id: number): CalloutTemplate | null {
    const r = this.db.get<Row>('SELECT * FROM callout_templates WHERE id = ?', id);
    return r ? mapTemplate(r) : null;
  }

  createTemplate(t: Omit<CalloutTemplate, 'id' | 'createdAt'>): CalloutTemplate {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO callout_templates (name, category, event, body, enabled, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      t.name,
      t.category,
      t.event,
      t.body,
      t.enabled,
      t.weight,
      Date.now(),
    );
    return this.getTemplate(lastInsertRowid)!;
  }

  updateTemplate(id: number, t: Omit<CalloutTemplate, 'id' | 'createdAt'>): CalloutTemplate | null {
    this.db.run(
      'UPDATE callout_templates SET name = ?, category = ?, event = ?, body = ?, enabled = ?, weight = ? WHERE id = ?',
      t.name,
      t.category,
      t.event,
      t.body,
      t.enabled,
      t.weight,
      id,
    );
    return this.getTemplate(id);
  }

  deleteTemplate(id: number): void {
    this.db.run('DELETE FROM callout_templates WHERE id = ?', id);
  }

  countTemplates(): number {
    return Number(this.db.get<Row>('SELECT COUNT(*) AS c FROM callout_templates')!.c);
  }

  insertCallout(c: Omit<Callout, 'id' | 'createdAt' | 'decidedAt'>): Callout {
    const now = Date.now();
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO callouts (template_id, session_id, trade_id, event, body, status, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      c.templateId,
      c.sessionId,
      c.tradeId,
      c.event,
      c.body,
      c.status,
      now,
      c.status === 'pending' ? null : now,
    );
    return this.getCallout(lastInsertRowid)!;
  }

  getCallout(id: number): Callout | null {
    const r = this.db.get<Row>('SELECT * FROM callouts WHERE id = ?', id);
    return r ? mapCallout(r) : null;
  }

  listCallouts(q: { status?: Callout['status']; limit?: number } = {}): Callout[] {
    const rows = q.status
      ? this.db.all<Row>('SELECT * FROM callouts WHERE status = ? ORDER BY id DESC LIMIT ?', q.status, q.limit ?? 200)
      : this.db.all<Row>('SELECT * FROM callouts ORDER BY id DESC LIMIT ?', q.limit ?? 200);
    return rows.map(mapCallout);
  }

  setCalloutStatus(id: number, status: Callout['status'], body?: string): Callout | null {
    if (body !== undefined) {
      this.db.run('UPDATE callouts SET status = ?, body = ?, decided_at = ? WHERE id = ?', status, body, Date.now(), id);
    } else {
      this.db.run('UPDATE callouts SET status = ?, decided_at = ? WHERE id = ?', status, Date.now(), id);
    }
    return this.getCallout(id);
  }

  lastCalloutAt(event: CalloutEvent): number | null {
    return n(this.db.get<Row>('SELECT MAX(created_at) AS t FROM callouts WHERE event = ?', event)?.t);
  }

  // ---------- errors ----------
  insertError(e: Omit<ErrorEntry, 'id' | 'acknowledged'>): ErrorEntry {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO errors (ts, level, source, message, context) VALUES (?, ?, ?, ?, ?)',
      e.ts,
      e.level,
      e.source,
      e.message,
      e.context ? JSON.stringify(e.context) : null,
    );
    return mapError(this.db.get<Row>('SELECT * FROM errors WHERE id = ?', lastInsertRowid)!);
  }

  listErrors(limit = 200): ErrorEntry[] {
    return this.db.all<Row>('SELECT * FROM errors ORDER BY id DESC LIMIT ?', limit).map(mapError);
  }

  countUnacknowledgedErrors(): number {
    return Number(this.db.get<Row>("SELECT COUNT(*) AS c FROM errors WHERE acknowledged = 0 AND level = 'error'")!.c);
  }

  acknowledgeErrors(): void {
    this.db.run('UPDATE errors SET acknowledged = 1 WHERE acknowledged = 0');
  }

  pruneErrors(keep = 5000): void {
    this.db.run('DELETE FROM errors WHERE id <= (SELECT MAX(id) FROM errors) - ?', keep);
  }

  // ---------- admin ----------
  getAdminHash(): string | null {
    return s(this.db.get<Row>('SELECT password_hash FROM admin WHERE id = 1')?.password_hash);
  }

  setAdminHash(hash: string): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO admin (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
      hash,
      now,
      now,
    );
  }

  createAuthSession(tokenHash: string, expiresAt: number, ip: string | null): void {
    this.db.run(
      'INSERT INTO auth_sessions (token_hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?)',
      tokenHash,
      Date.now(),
      expiresAt,
      ip,
    );
  }

  getAuthSessionExpiry(tokenHash: string): number | null {
    return n(this.db.get<Row>('SELECT expires_at FROM auth_sessions WHERE token_hash = ?', tokenHash)?.expires_at);
  }

  deleteAuthSession(tokenHash: string): void {
    this.db.run('DELETE FROM auth_sessions WHERE token_hash = ?', tokenHash);
  }

  deleteAllAuthSessions(): void {
    this.db.run('DELETE FROM auth_sessions');
  }

  purgeExpiredAuthSessions(): void {
    this.db.run('DELETE FROM auth_sessions WHERE expires_at < ?', Date.now());
  }
}
