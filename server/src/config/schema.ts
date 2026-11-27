import { z } from 'zod';
import { CALLOUT_EVENTS, SCENARIOS } from '../../../shared/types.ts';
import type { AppSettings, SettingsSection } from '../../../shared/types.ts';

const scenario = z.enum(SCENARIOS);
const pct = (max = 1000) => z.number().min(0).max(max);

export const tradingSchema = z
  .object({
    minTradeUsd: z.number().min(0.01).max(1_000_000),
    maxTradeUsd: z.number().min(0.01).max(1_000_000),
    tradeSizing: z.enum(['random', 'fixed']),
    fixedTradeUsd: z.number().min(0.01).max(1_000_000),
    minHoldSeconds: z.number().int().min(0).max(86_400),
    maxHoldSeconds: z.number().int().min(0).max(7 * 86_400),
    takeProfitPct: pct(),
    stopLossPct: pct(100),
    trailingStopPct: pct(100),
    hardStopLossPct: pct(100),
    entryScenarios: z.array(scenario),
    exitOnScenarios: z.array(scenario),
    minConfidence: z.number().min(0).max(1),
    maxOpenPositions: z.number().int().min(1).max(50),
    maxPositionsPerWallet: z.number().int().min(0).max(50),
    buyCooldownSeconds: z.number().int().min(0).max(86_400),
    minLiquidityUsd: z.number().min(0),
    evaluationIntervalSeconds: z.number().min(1).max(300),
    slippageBps: z.number().int().min(1).max(5000),
    priorityFeeLamports: z.number().int().min(0).max(50_000_000),
    paperStartingCapitalUsd: z.number().min(0.1).max(1_000_000),
    paperPlatformFeePct: pct(10),
    paperNetworkFeeSol: z.number().min(0).max(0.1),
    paperSlippagePct: pct(50),
    paperAtaRentSol: z.number().min(0).max(0.1),
  })
  .refine((v) => v.maxTradeUsd >= v.minTradeUsd, {
    message: 'Maksymalna kwota musi być ≥ minimalnej',
    path: ['maxTradeUsd'],
  })
  .refine((v) => v.maxHoldSeconds === 0 || v.maxHoldSeconds >= v.minHoldSeconds, {
    message: 'Maks. czas trzymania musi być ≥ minimalnego (lub 0)',
    path: ['maxHoldSeconds'],
  });

export const riskSchema = z.object({
  maxDeployedUsd: z.number().min(0.01),
  maxDeployedPctOfEquity: pct(100),
  maxSessionLossUsd: z.number().min(0),
  maxSessionLossPct: pct(100),
  maxCostsUsd: z.number().min(0),
  maxTradesPerSession: z.number().int().min(1).max(100_000),
  maxTradesPerHour: z.number().int().min(1).max(10_000),
  solReserve: z.number().min(0).max(10),
  onLimitBreach: z.enum(['pause', 'stop_and_liquidate']),
  emergencyLiquidate: z.boolean(),
  pauseKeepsHardStop: z.boolean(),
  maxOrderRetries: z.number().int().min(1).max(10),
  errorRecoverySeconds: z.number().int().min(5).max(3600),
  maxDataAgeSeconds: z.number().int().min(5).max(600),
});

export const analysisSchema = z.object({
  timeframeSec: z.number().int().min(5).max(86_400),
  lookbackCandles: z.number().int().min(5).max(500),
  momentumBars: z.number().int().min(1).max(100),
  minSamples: z.number().int().min(3).max(500),
  aggressiveSlopePct: z.number().min(0),
  aggressiveMomentumPct: z.number().min(0),
  moderateSlopePct: z.number().min(0),
  volatileGrowthVolPct: z.number().min(0),
  flatSlopePct: z.number().min(0),
  baseMaxAmplitudePct: z.number().min(0),
  baseMinVolumeRatio: z.number().min(0),
  stableMaxVolPct: z.number().min(0),
  highVolPct: z.number().min(0),
  downSlopePct: z.number().min(0),
});

const calloutEvent = z.object({
  enabled: z.boolean(),
  probabilityPct: pct(100),
  minIntervalSec: z.number().int().min(0).max(86_400),
});

export const calloutSchema = z.object({
  enabled: z.boolean(),
  requireApproval: z.boolean(),
  autoLabel: z.string().min(1).max(60),
  events: z.object(Object.fromEntries(CALLOUT_EVENTS.map((e) => [e, calloutEvent])) as Record<
    (typeof CALLOUT_EVENTS)[number],
    typeof calloutEvent
  >),
});

export const systemSchema = z.object({
  marketPollMs: z.number().int().min(1000).max(60_000),
  candleRefreshSec: z.number().int().min(5).max(600),
  walletPollSec: z.number().int().min(5).max(3600),
  equitySnapshotSec: z.number().int().min(5).max(3600),
  rpcUrl: z.string().url(),
  jupiterBaseUrl: z.string().url(),
  simulatedSolUsd: z.number().min(1).max(100_000),
  resumeAfterRestart: z.boolean(),
  backupIntervalHours: z.number().min(0).max(168),
  backupKeep: z.number().int().min(1).max(365),
});

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Nieprawidłowy adres kontraktu (0x…)');

export const evmChainSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Klucz sieci: małe litery, cyfry, myślnik (jak w DexScreener)'),
  name: z.string().min(1).max(60),
  chainId: z.number().int().positive(),
  enabled: z.boolean(),
  nativeSymbol: z.string().min(1).max(10),
  rpcUrl: z.string().url(),
  explorerUrl: z.string().url(),
  geckoNetwork: z.string().max(40),
  nativePriceRef: z.string().regex(/^[a-z0-9-]+:0x[0-9a-fA-F]{40}$/, 'Format: siec:0xadres (np. ethereum:0xC02a…)'),
  routerAllowlist: z.array(evmAddress).max(20),
  paperGasFeeNative: z.number().min(0).max(1),
  gasReserveNative: z.number().min(0).max(10),
  simulatedNativeUsd: z.number().min(0.01).max(1_000_000),
});

export const evmSchema = z
  .object({
    lifiBaseUrl: z.string().url(),
    chains: z.array(evmChainSchema).max(30),
  })
  .refine((v) => new Set(v.chains.map((c) => c.key)).size === v.chains.length, { message: 'Klucze sieci muszą być unikalne', path: ['chains'] });

export const SECTION_SCHEMAS = {
  trading: tradingSchema,
  risk: riskSchema,
  analysis: analysisSchema,
  callouts: calloutSchema,
  system: systemSchema,
  evm: evmSchema,
} satisfies Record<SettingsSection, z.ZodType>;

// Wartości domyślne zgodne z założeniami projektu (pkt 5). Nie są rekomendacją inwestycyjną.
export const DEFAULT_SETTINGS: AppSettings = {
  trading: {
    minTradeUsd: 0.2,
    maxTradeUsd: 1.5,
    tradeSizing: 'random',
    fixedTradeUsd: 0.5,
    minHoldSeconds: 60,
    maxHoldSeconds: 900,
    takeProfitPct: 15,
    stopLossPct: 10,
    trailingStopPct: 8,
    hardStopLossPct: 25,
    entryScenarios: ['MODERATE_GROWTH', 'BASE_BUILDING'],
    exitOnScenarios: ['DOWNTREND'],
    minConfidence: 0.3,
    maxOpenPositions: 1,
    maxPositionsPerWallet: 0,
    buyCooldownSeconds: 90,
    minLiquidityUsd: 3000,
    evaluationIntervalSeconds: 3,
    slippageBps: 300,
    priorityFeeLamports: 100_000,
    paperStartingCapitalUsd: 1.5,
    paperPlatformFeePct: 1,
    paperNetworkFeeSol: 0.000005,
    paperSlippagePct: 0.5,
    paperAtaRentSol: 0.00203928,
  },
  risk: {
    maxDeployedUsd: 1.5,
    maxDeployedPctOfEquity: 100,
    maxSessionLossUsd: 0.5,
    maxSessionLossPct: 40,
    maxCostsUsd: 0.6,
    maxTradesPerSession: 60,
    maxTradesPerHour: 20,
    solReserve: 0.002,
    onLimitBreach: 'pause',
    emergencyLiquidate: true,
    pauseKeepsHardStop: true,
    maxOrderRetries: 3,
    errorRecoverySeconds: 30,
    maxDataAgeSeconds: 30,
  },
  analysis: {
    timeframeSec: 60,
    lookbackCandles: 30,
    momentumBars: 5,
    minSamples: 10,
    aggressiveSlopePct: 1.0,
    aggressiveMomentumPct: 5,
    moderateSlopePct: 0.25,
    volatileGrowthVolPct: 3,
    flatSlopePct: 0.15,
    baseMaxAmplitudePct: 12,
    baseMinVolumeRatio: 0.8,
    stableMaxVolPct: 1.0,
    highVolPct: 4,
    downSlopePct: 0.25,
  },
  callouts: {
    enabled: true,
    requireApproval: true,
    autoLabel: '🤖 [AUTO]',
    events: {
      buy: { enabled: true, probabilityPct: 100, minIntervalSec: 0 },
      sell: { enabled: false, probabilityPct: 100, minIntervalSec: 0 },
      close_profit: { enabled: true, probabilityPct: 100, minIntervalSec: 0 },
      close_loss: { enabled: true, probabilityPct: 100, minIntervalSec: 0 },
    },
  },
  system: {
    marketPollMs: 3000,
    candleRefreshSec: 20,
    walletPollSec: 30,
    equitySnapshotSec: 15,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    jupiterBaseUrl: 'https://lite-api.jup.ag/swap/v1',
    simulatedSolUsd: 150,
    resumeAfterRestart: false,
    backupIntervalHours: 6,
    backupKeep: 20,
  },
  evm: {
    lifiBaseUrl: 'https://li.quest/v1',
    chains: [
      {
        key: 'robinhood',
        name: 'Robinhood Chain',
        chainId: 4663,
        enabled: true,
        nativeSymbol: 'ETH',
        rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
        explorerUrl: 'https://robinhoodchain.blockscout.com',
        geckoNetwork: 'robinhood',
        nativePriceRef: 'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        routerAllowlist: ['0xB477751B76CF82d00a686A1232f5fCD772414Af3'], // kontrakt LI.FI na Robinhood Chain
        paperGasFeeNative: 0.000015,
        gasReserveNative: 0.0003,
        simulatedNativeUsd: 1700,
      },
      {
        key: 'base',
        name: 'Base',
        chainId: 8453,
        enabled: false,
        nativeSymbol: 'ETH',
        rpcUrl: 'https://mainnet.base.org',
        explorerUrl: 'https://basescan.org',
        geckoNetwork: 'base',
        nativePriceRef: 'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        routerAllowlist: ['0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'],
        paperGasFeeNative: 0.000005,
        gasReserveNative: 0.0003,
        simulatedNativeUsd: 1700,
      },
      {
        key: 'ethereum',
        name: 'Ethereum',
        chainId: 1,
        enabled: false,
        nativeSymbol: 'ETH',
        rpcUrl: 'https://ethereum-rpc.publicnode.com',
        explorerUrl: 'https://etherscan.io',
        geckoNetwork: 'eth',
        nativePriceRef: 'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        routerAllowlist: ['0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'],
        paperGasFeeNative: 0.0005,
        gasReserveNative: 0.003,
        simulatedNativeUsd: 1700,
      },
      {
        key: 'arbitrum',
        name: 'Arbitrum One',
        chainId: 42161,
        enabled: false,
        nativeSymbol: 'ETH',
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        explorerUrl: 'https://arbiscan.io',
        geckoNetwork: 'arbitrum',
        nativePriceRef: 'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        routerAllowlist: ['0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'],
        paperGasFeeNative: 0.00001,
        gasReserveNative: 0.0003,
        simulatedNativeUsd: 1700,
      },
      {
        key: 'bsc',
        name: 'BNB Smart Chain',
        chainId: 56,
        enabled: false,
        nativeSymbol: 'BNB',
        rpcUrl: 'https://bsc-dataseed.bnbchain.org',
        explorerUrl: 'https://bscscan.com',
        geckoNetwork: 'bsc',
        nativePriceRef: 'bsc:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        routerAllowlist: ['0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'],
        paperGasFeeNative: 0.00005,
        gasReserveNative: 0.002,
        simulatedNativeUsd: 600,
      },
    ],
  },
};

export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'wartość'}: ${i.message}`).join('; ');
}
