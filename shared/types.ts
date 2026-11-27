// Typy i stałe wspólne dla serwera i panelu.
// Tylko składnia „erasable” (bez enum/namespace), bo serwer uruchamia TS natywnie w Node.

export const BOT_STATES = [
  'OFFLINE',
  'IDLE',
  'WATCHING',
  'AWAITING_TASK',
  'BUYING',
  'HOLDING',
  'SELLING',
  'PAUSED',
  'ERROR',
] as const;
export type BotState = (typeof BOT_STATES)[number];

export const BOT_STATE_LABELS: Record<BotState, string> = {
  OFFLINE: 'Offline',
  IDLE: 'Idle',
  WATCHING: 'Obserwowanie tokena',
  AWAITING_TASK: 'Oczekiwanie na zadanie',
  BUYING: 'Kupowanie',
  HOLDING: 'Utrzymywanie pozycji',
  SELLING: 'Sprzedawanie',
  PAUSED: 'Wstrzymanie',
  ERROR: 'Błąd',
};

export const SCENARIOS = [
  'AGGRESSIVE_GROWTH',
  'MODERATE_GROWTH',
  'VOLATILE_GROWTH',
  'BASE_BUILDING',
  'STABLE_MARKET',
  'HIGH_VOLATILITY',
  'DOWNTREND',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const SCENARIO_LABELS: Record<Scenario, string> = {
  AGGRESSIVE_GROWTH: 'Aggressive Growth',
  MODERATE_GROWTH: 'Moderate Growth',
  VOLATILE_GROWTH: 'Volatile Growth',
  BASE_BUILDING: 'Base Building',
  STABLE_MARKET: 'Stable Market',
  HIGH_VOLATILITY: 'High Volatility',
  DOWNTREND: 'Downtrend',
};

export const CALLOUT_EVENTS = ['buy', 'sell', 'close_profit', 'close_loss'] as const;
export type CalloutEvent = (typeof CALLOUT_EVENTS)[number];
export const CALLOUT_EVENT_LABELS: Record<CalloutEvent, string> = {
  buy: 'Kupno',
  sell: 'Sprzedaż',
  close_profit: 'Zamknięcie z zyskiem',
  close_loss: 'Zamknięcie ze stratą',
};

export const PLATFORMS = ['pumpfun', 'gmgn', 'fomo', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ExecutionMode = 'paper' | 'live';
export type DataSource = 'live' | 'simulated';
export type SessionStatus = 'running' | 'paused' | 'stopping' | 'stopped' | 'emergency_stopped';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'executing' | 'filled' | 'failed' | 'cancelled';
export type FeedStatus = 'idle' | 'ok' | 'degraded' | 'down';

// ---------- Sieci ----------
//
// UWAGA: pola z sufiksem „Sol” (priceSol, valueSol, costSol, solUsd, Money.sol…) przechowują kwoty
// w walucie natywnej sieci sesji: SOL na Solanie, ETH na Robinhood Chain/Base/Ethereum/Arbitrum, BNB na BSC.
// Symbol waluty jest w `nativeSymbol` (token, sesja, statystyki).

export const SOLANA = 'solana';

export interface EvmChainConfig {
  key: string; // identyfikator sieci w DexScreener, np. „robinhood”
  name: string;
  chainId: number;
  enabled: boolean;
  nativeSymbol: string;
  rpcUrl: string;
  explorerUrl: string;
  geckoNetwork: string; // sieć w GeckoTerminal ('' = świece tylko z ticków)
  nativePriceRef: string; // token do wyceny waluty natywnej, np. „ethereum:0xC02a…” (WETH)
  routerAllowlist: string[]; // kontrakty, do których wolno wysyłać środki/approve (puste = brak ograniczenia)
  paperGasFeeNative: number; // szacowana opłata za transakcję (symulacja i limity ryzyka)
  gasReserveNative: number; // rezerwa waluty natywnej na opłaty
  simulatedNativeUsd: number; // kurs waluty natywnej w symulatorze
}

export interface EvmConfig {
  lifiBaseUrl: string;
  chains: EvmChainConfig[];
}

// ---------- Rynek ----------

export interface TokenInfo {
  address: string;
  chain: string; // 'solana' albo klucz sieci EVM
  nativeSymbol: string;
  name: string;
  symbol: string;
  pairAddress: string;
  dexId: string;
  quoteSymbol: string;
  url: string;
  imageUrl?: string;
  priceUsd: number;
  priceSol: number; // cena w walucie natywnej sieci
  liquidityUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
}

export interface Candle {
  time: number; // sekundy UNIX, początek świecy
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD
}

export interface MarketSnapshot {
  ts: number; // ms
  priceUsd: number;
  priceSol: number;
  solUsd: number;
  liquidityUsd: number;
  volume5mUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buys5m: number;
  sells5m: number;
  priceChange5mPct: number;
  priceChange1hPct: number;
}

export interface MarketMetrics {
  trendSlopePct: number; // % na świecę (regresja log-ceny)
  trendR2: number;
  direction: 'up' | 'down' | 'flat';
  momentumPct: number; // zmiana ceny w N świecach
  accelerationPct: number; // zmiana momentum
  volatilityPct: number; // odch. std. log-zwrotów na świecę
  amplitudePct: number; // (max high - min low) / średnia cena
  volumeWindowUsd: number;
  volumeRatio: number; // wolumen 2. połowy okna / 1. połowy
  liquidityUsd: number;
  drawdownPct: number; // spadek od szczytu w oknie
}

export interface MarketAnalysis {
  ts: number;
  scenario: Scenario;
  confidence: number; // 0..1
  insufficientData: boolean;
  sampleSize: number;
  metrics: MarketMetrics;
  reasons: string[];
}

export interface FeedHealth {
  status: FeedStatus;
  source: DataSource | null;
  lastTickAt: number | null;
  lastCandleRefreshAt: number | null;
  consecutiveErrors: number;
  lastError: string | null;
}

// ---------- Konfiguracja ----------

export interface TradingConfig {
  minTradeUsd: number;
  maxTradeUsd: number;
  tradeSizing: 'random' | 'fixed';
  fixedTradeUsd: number;
  minHoldSeconds: number;
  maxHoldSeconds: number; // 0 = bez limitu
  takeProfitPct: number; // 0 = wyłączone
  stopLossPct: number; // 0 = wyłączone (respektuje min. czas trzymania)
  trailingStopPct: number; // 0 = wyłączone
  hardStopLossPct: number; // 0 = wyłączone (ignoruje min. czas trzymania)
  entryScenarios: Scenario[];
  exitOnScenarios: Scenario[];
  minConfidence: number;
  maxOpenPositions: number;
  buyCooldownSeconds: number;
  minLiquidityUsd: number;
  evaluationIntervalSeconds: number;
  slippageBps: number;
  priorityFeeLamports: number;
  paperStartingCapitalUsd: number;
  paperPlatformFeePct: number;
  paperNetworkFeeSol: number;
  paperSlippagePct: number;
  paperAtaRentSol: number;
}

export interface RiskConfig {
  maxDeployedUsd: number;
  maxDeployedPctOfEquity: number;
  maxSessionLossUsd: number; // 0 = wyłączone
  maxSessionLossPct: number; // 0 = wyłączone
  maxCostsUsd: number; // prowizje + opłaty sieci + rent; 0 = wyłączone
  maxTradesPerSession: number;
  maxTradesPerHour: number;
  solReserve: number; // SOL zostawiane na opłaty sieci
  onLimitBreach: 'pause' | 'stop_and_liquidate';
  emergencyLiquidate: boolean;
  pauseKeepsHardStop: boolean;
  maxOrderRetries: number;
  errorRecoverySeconds: number;
  maxDataAgeSeconds: number;
}

export interface AnalysisConfig {
  timeframeSec: number;
  lookbackCandles: number;
  momentumBars: number;
  minSamples: number;
  aggressiveSlopePct: number;
  aggressiveMomentumPct: number;
  moderateSlopePct: number;
  volatileGrowthVolPct: number;
  flatSlopePct: number;
  baseMaxAmplitudePct: number;
  baseMinVolumeRatio: number;
  stableMaxVolPct: number;
  highVolPct: number;
  downSlopePct: number;
}

export interface CalloutEventConfig {
  enabled: boolean;
  probabilityPct: number;
  minIntervalSec: number;
}

export interface CalloutConfig {
  enabled: boolean;
  requireApproval: boolean;
  autoLabel: string;
  events: Record<CalloutEvent, CalloutEventConfig>;
}

export interface SystemConfig {
  marketPollMs: number;
  candleRefreshSec: number;
  walletPollSec: number;
  equitySnapshotSec: number;
  rpcUrl: string;
  jupiterBaseUrl: string;
  simulatedSolUsd: number;
  resumeAfterRestart: boolean;
  backupIntervalHours: number;
  backupKeep: number;
}

export interface AppSettings {
  trading: TradingConfig;
  risk: RiskConfig;
  analysis: AnalysisConfig;
  callouts: CalloutConfig;
  system: SystemConfig;
  evm: EvmConfig;
}
export type SettingsSection = keyof AppSettings;

export interface Preset {
  id: number;
  kind: 'trading' | 'analysis';
  name: string;
  data: unknown;
  createdAt: number;
}

// ---------- Domena handlowa ----------

export interface SessionRecord {
  id: number;
  chain: string;
  nativeSymbol: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  pairAddress: string;
  mode: ExecutionMode;
  dataSource: DataSource;
  status: SessionStatus;
  startedAt: number;
  endedAt: number | null;
  startCapitalSol: number;
  startCapitalUsd: number;
  startSolUsd: number;
  paperBalanceSol: number;
  rentPaidSol: number;
  summary: SessionStats | null;
}

export interface Position {
  id: number;
  sessionId: number;
  status: 'open' | 'closed';
  openedAt: number;
  closedAt: number | null;
  amount: number;
  decimals: number;
  entryPriceSol: number;
  entryPriceUsd: number;
  costSol: number;
  peakPriceSol: number;
  exitPriceSol: number | null;
  exitPriceUsd: number | null;
  proceedsSol: number | null;
  realizedPnlSol: number | null;
  realizedPnlUsd: number | null;
  feesSol: number;
  exitReason: string | null;
  // wyliczane na bieżąco
  markPriceSol?: number;
  unrealizedPnlSol?: number;
  unrealizedPnlUsd?: number;
  unrealizedPnlPct?: number;
}

export interface Trade {
  id: number;
  sessionId: number;
  positionId: number;
  side: OrderSide;
  ts: number;
  priceSol: number;
  priceUsd: number;
  amount: number;
  valueSol: number;
  valueUsd: number;
  feeSol: number;
  networkFeeSol: number;
  solUsd: number;
  txSignature: string | null;
  mode: ExecutionMode;
  reason: string;
  tokenSymbol?: string;
  chain?: string;
  nativeSymbol?: string;
}

export interface Order {
  id: number;
  sessionId: number;
  side: OrderSide;
  valueSol: number | null;
  positionId: number | null;
  reason: string;
  status: OrderStatus;
  attempts: number;
  error: string | null;
  txSignature: string | null;
  tradeId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EquityPoint {
  ts: number;
  balanceSol: number;
  positionsValueSol: number;
  equitySol: number;
  equityUsd: number;
}

export interface Money {
  sol: number;
  usd: number;
}

export interface SessionStats {
  sessionId: number;
  startCapital: Money;
  currentCapital: Money;
  balance: Money;
  positionsValue: Money;
  realizedPnl: Money;
  unrealizedPnl: Money;
  totalPnl: Money;
  pnlPct: number;
  platformFees: Money;
  networkFees: Money;
  rent: Money;
  totalCosts: Money;
  buys: number;
  sells: number;
  wins: number;
  losses: number;
  totalVolume: Money;
  avgTrade: Money;
  openPositions: number;
  durationSec: number;
  solUsd: number;
  nativeSymbol?: string;
}

export interface BotSnapshot {
  state: BotState;
  since: number;
  previous: BotState | null;
  lastAction: string | null;
  lastError: string | null;
  watchingSince: number | null;
  lastEvaluationAt: number | null;
  lastSignal: string | null;
}

export interface CalloutTemplate {
  id: number;
  name: string;
  category: string;
  event: CalloutEvent;
  body: string;
  enabled: boolean;
  weight: number;
  createdAt: number;
}

export interface Callout {
  id: number;
  templateId: number | null;
  sessionId: number | null;
  tradeId: number | null;
  event: CalloutEvent;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt: number | null;
}

export interface ErrorEntry {
  id: number;
  ts: number;
  level: 'warn' | 'error';
  source: string;
  message: string;
  context: Record<string, unknown> | null;
  acknowledged: boolean;
}

export interface AccountInfo {
  name: string;
  email: string;
  platform: Platform;
  walletAddress: string;
  evmWalletAddress: string;
  secrets: { name: string; isSet: boolean; updatedAt: number | null }[];
  /** Poprzednie portfele bota (klucze zachowane w archiwum po zmianie portfela). */
  archivedWallets: ArchivedWallet[];
}

export type WalletKind = 'solana' | 'evm';

export interface ArchivedWallet {
  id: number;
  kind: WalletKind;
  address: string;
  archivedAt: number;
}

/** Dane profilu bez sekretów i archiwum (zapisywane w tabeli account). */
export type AccountProfile = Omit<AccountInfo, 'secrets' | 'archivedWallets'>;

export interface WalletInfo {
  address: string | null;
  solBalance: number | null;
  tokenBalance: number | null;
  tokenMint: string | null;
  solUsd: number;
  updatedAt: number | null;
  error: string | null;
  evm: EvmWalletInfo | null;
}

export interface EvmWalletInfo {
  address: string;
  chain: string;
  nativeSymbol: string;
  nativeBalance: number | null;
  tokenBalance: number | null;
  nativeUsd: number;
  error: string | null;
}

export interface HealthInfo {
  ts: number;
  uptimeSec: number;
  cpuPct: number;
  rssMb: number;
  heapUsedMb: number;
  systemMemUsedPct: number;
  loadAvg: number[];
  eventLoopLagMs: number;
  sseClients: number;
  queueLength: number;
  dbSizeMb: number;
  feed: FeedHealth;
  unacknowledgedErrors: number;
  lastBackupAt: number | null;
}

export interface AppStateSnapshot {
  bot: BotSnapshot;
  session: SessionRecord | null;
  token: TokenInfo | null;
  market: {
    snapshot: MarketSnapshot | null;
    analysis: MarketAnalysis | null;
    candles: Candle[];
    feed: FeedHealth;
  };
  positions: Position[];
  trades: Trade[];
  orders: Order[];
  callouts: Callout[];
  stats: SessionStats | null;
  wallet: WalletInfo;
  health: HealthInfo | null;
  settings: AppSettings;
}

// Zdarzenia przesyłane do panelu przez SSE
export type StreamEvent =
  | { type: 'market.tick'; snapshot: MarketSnapshot; candle: Candle | null }
  | { type: 'market.candles'; candles: Candle[]; replace: boolean }
  | { type: 'market.analysis'; analysis: MarketAnalysis }
  | { type: 'market.feed'; feed: FeedHealth }
  | { type: 'bot.state'; bot: BotSnapshot }
  | { type: 'session.updated'; session: SessionRecord | null; token: TokenInfo | null }
  | { type: 'order.updated'; order: Order }
  | { type: 'trade.executed'; trade: Trade }
  | { type: 'position.updated'; position: Position }
  | { type: 'stats.updated'; stats: SessionStats | null }
  | { type: 'callout.updated'; callout: Callout }
  | { type: 'wallet.updated'; wallet: WalletInfo }
  | { type: 'system.health'; health: HealthInfo }
  | { type: 'error'; error: ErrorEntry }
  | { type: 'settings.updated'; settings: AppSettings }
  | { type: 'risk.breach'; reason: string; action: string };
