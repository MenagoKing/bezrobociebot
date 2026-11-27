import type { TacticsConfig } from './types.ts';

/** Domyślne taktyki Playzone (serwer: wartości startowe; panel: zapas, gdy serwer jeszcze ich nie wysyła). */
export const DEFAULT_TACTICS: TacticsConfig = {
  volume: {
    entryScenarios: ['AGGRESSIVE_GROWTH', 'MODERATE_GROWTH', 'VOLATILE_GROWTH', 'BASE_BUILDING'],
    exitOnScenarios: ['DOWNTREND'],
    minConfidence: 0.25,
    minVolumeRatio: 1.5,
    minBuySellRatio: 1.3,
    takeProfitPct: 12,
    stopLossPct: 8,
    trailingStopPct: 6,
    minHoldSeconds: 30,
    maxHoldSeconds: 600,
    buyCooldownSeconds: 60,
  },
  maxprofit: {
    entryScenarios: ['AGGRESSIVE_GROWTH', 'MODERATE_GROWTH'],
    exitOnScenarios: ['DOWNTREND'],
    minConfidence: 0.5,
    minVolumeRatio: 0,
    minBuySellRatio: 0,
    takeProfitPct: 0,
    stopLossPct: 12,
    trailingStopPct: 12,
    minHoldSeconds: 60,
    maxHoldSeconds: 3600,
    buyCooldownSeconds: 120,
  },
};
