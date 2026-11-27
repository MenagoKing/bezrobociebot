// Każdy element tablicy to jedna migracja; nowe dopisuj na końcu, istniejących nie zmieniaj.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    section TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('trading', 'analysis')),
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (kind, name)
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT 'pumpfun',
    wallet_address TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  INSERT INTO account (id, updated_at) VALUES (1, 0);

  CREATE TABLE secrets (
    name TEXT PRIMARY KEY,
    ciphertext TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_address TEXT NOT NULL,
    token_name TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    pair_address TEXT NOT NULL,
    token_json TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
    data_source TEXT NOT NULL CHECK (data_source IN ('live', 'simulated')),
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    start_capital_sol REAL NOT NULL,
    start_capital_usd REAL NOT NULL,
    start_sol_usd REAL NOT NULL,
    paper_balance_sol REAL NOT NULL DEFAULT 0,
    rent_paid_sol REAL NOT NULL DEFAULT 0,
    config_snapshot TEXT NOT NULL,
    summary TEXT
  );
  CREATE INDEX idx_sessions_status ON sessions(status);

  CREATE TABLE positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    amount REAL NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 6,
    entry_price_sol REAL NOT NULL,
    entry_price_usd REAL NOT NULL,
    cost_sol REAL NOT NULL,
    peak_price_sol REAL NOT NULL,
    exit_price_sol REAL,
    exit_price_usd REAL,
    proceeds_sol REAL,
    realized_pnl_sol REAL,
    realized_pnl_usd REAL,
    fees_sol REAL NOT NULL DEFAULT 0,
    exit_reason TEXT
  );
  CREATE INDEX idx_positions_session ON positions(session_id, status);

  CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    position_id INTEGER NOT NULL REFERENCES positions(id),
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    ts INTEGER NOT NULL,
    price_sol REAL NOT NULL,
    price_usd REAL NOT NULL,
    amount REAL NOT NULL,
    value_sol REAL NOT NULL,
    value_usd REAL NOT NULL,
    fee_sol REAL NOT NULL DEFAULT 0,
    network_fee_sol REAL NOT NULL DEFAULT 0,
    sol_usd REAL NOT NULL,
    tx_signature TEXT,
    mode TEXT NOT NULL,
    reason TEXT NOT NULL
  );
  CREATE INDEX idx_trades_session ON trades(session_id, ts);

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    value_sol REAL,
    position_id INTEGER,
    reason TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    error TEXT,
    tx_signature TEXT,
    trade_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_orders_status ON orders(status, next_attempt_at);

  CREATE TABLE equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    ts INTEGER NOT NULL,
    balance_sol REAL NOT NULL,
    positions_value_sol REAL NOT NULL,
    equity_sol REAL NOT NULL,
    equity_usd REAL NOT NULL,
    sol_usd REAL NOT NULL
  );
  CREATE INDEX idx_equity_session ON equity_snapshots(session_id, ts);

  -- callout_templates / callouts: po usuniętym Callout Managerze; zostają, żeby nie zmieniać historii migracji
  CREATE TABLE callout_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'ogólne',
    event TEXT NOT NULL CHECK (event IN ('buy', 'sell', 'close_profit', 'close_loss')),
    body TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    weight INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE callouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER,
    session_id INTEGER,
    trade_id INTEGER,
    event TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE INDEX idx_callouts_status ON callouts(status, created_at);

  CREATE TABLE errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    context TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_errors_ts ON errors(ts);

  CREATE TABLE admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT
  );
  `,
  // 2: obsługa wielu sieci (Solana + EVM)
  `
  ALTER TABLE sessions ADD COLUMN chain TEXT NOT NULL DEFAULT 'solana';
  ALTER TABLE sessions ADD COLUMN native_symbol TEXT NOT NULL DEFAULT 'SOL';
  ALTER TABLE account ADD COLUMN evm_wallet_address TEXT NOT NULL DEFAULT '';
  `,
  // 3: archiwum poprzednich portfeli bota — klucz zostaje zaszyfrowany tak samo jak w secrets (AAD = nazwa sekretu)
  `
  CREATE TABLE wallet_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('solana', 'evm')),
    address TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    archived_at INTEGER NOT NULL
  );
  CREATE INDEX idx_wallet_archive_kind ON wallet_archive(kind, archived_at);
  `,
];
