import { useSyncExternalStore } from 'react';
import type { AppStateSnapshot, Candle, ErrorEntry, MarketAnalysis, Scenario, StreamEvent } from '../../shared/types.ts';
import { api } from './api.ts';

export interface Meta {
  liveTradingEnabled: boolean;
  liveConfirmPhrase: string;
  version: string;
  buildId?: string;
}

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'warn' | 'error';
  text: string;
}

export interface State extends AppStateSnapshot {
  loaded: boolean;
  connected: boolean;
  meta: Meta;
  recentErrors: ErrorEntry[];
  scenarioHistory: { ts: number; scenario: Scenario; confidence: number }[];
  historyVersion: number;
  toasts: Toast[];
  updateAvailable: boolean;
}

const ACTIVE = new Set(['running', 'paused', 'stopping']);
const MAX_CANDLES = 600;

let state: State = {
  loaded: false,
  connected: false,
  meta: { liveTradingEnabled: false, liveConfirmPhrase: 'HANDEL LIVE', version: '' },
  bot: { state: 'OFFLINE', since: Date.now(), previous: null, lastAction: null, lastError: null, watchingSince: null, lastEvaluationAt: null, lastSignal: null },
  session: null,
  token: null,
  market: { snapshot: null, analysis: null, candles: [], feed: { status: 'idle', source: null, lastTickAt: null, lastCandleRefreshAt: null, consecutiveErrors: 0, lastError: null } },
  positions: [],
  trades: [],
  orders: [],
  stats: null,
  wallet: { address: null, solBalance: null, tokenBalance: null, tokenMint: null, solUsd: 0, updatedAt: null, error: null, evm: null, extra: [] },
  health: null,
  settings: null as unknown as State['settings'],
  recentErrors: [],
  scenarioHistory: [],
  historyVersion: 0,
  toasts: [],
  updateAvailable: false,
};

const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export const getState = () => state;

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 5000): void {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

function mergeCandles(current: Candle[], incoming: Candle[]): Candle[] {
  if (!incoming.length) return current;
  const map = new Map(current.map((c) => [c.time, c]));
  for (const c of incoming) map.set(c.time, c);
  return [...map.values()].sort((a, b) => a.time - b.time).slice(-MAX_CANDLES);
}

function pushScenario(s: State, a: MarketAnalysis): State['scenarioHistory'] {
  if (a.insufficientData) return s.scenarioHistory;
  const last = s.scenarioHistory[s.scenarioHistory.length - 1];
  if (last && last.scenario === a.scenario) return s.scenarioHistory;
  return [...s.scenarioHistory, { ts: a.ts, scenario: a.scenario, confidence: a.confidence }].slice(-60);
}

function upsert<T extends { id: number }>(list: T[], item: T, cap: number): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const copy = list.slice();
    copy[idx] = item;
    return copy;
  }
  return [item, ...list].slice(0, cap);
}

export function applyEvent(ev: StreamEvent): void {
  switch (ev.type) {
    case 'market.tick':
      return set((s) => {
        let candles = s.market.candles;
        if (ev.candle) {
          const last = candles[candles.length - 1];
          if (last && last.time === ev.candle.time) candles = [...candles.slice(0, -1), ev.candle];
          else if (!last || ev.candle.time > last.time) candles = [...candles, ev.candle].slice(-MAX_CANDLES);
        }
        return { market: { ...s.market, snapshot: ev.snapshot, candles } };
      });
    case 'market.candles':
      return set((s) => ({ market: { ...s.market, candles: ev.replace ? ev.candles.slice(-MAX_CANDLES) : mergeCandles(s.market.candles, ev.candles) } }));
    case 'market.analysis':
      return set((s) => ({ market: { ...s.market, analysis: ev.analysis }, scenarioHistory: pushScenario(s, ev.analysis) }));
    case 'market.feed':
      return set((s) => ({ market: { ...s.market, feed: ev.feed } }));
    case 'bot.state':
      return set({ bot: ev.bot });
    case 'session.updated': {
      const active = !!ev.session && ACTIVE.has(ev.session.status);
      return set((s) => ({
        session: active ? ev.session : null,
        token: active ? ev.token : null,
        historyVersion: s.historyVersion + 1,
        ...(active
          ? {}
          : {
              positions: [],
              stats: null,
              orders: [],
              scenarioHistory: [],
              market: { ...s.market, snapshot: null, analysis: null, candles: [] },
            }),
      }));
    }
    case 'order.updated':
      return set((s) => ({ orders: upsert(s.orders, ev.order, 50) }));
    case 'trade.executed':
      return set((s) => ({ trades: upsert(s.trades, ev.trade, 100) }));
    case 'position.updated':
      return set((s) => ({
        positions: ev.position.status === 'open' ? upsert(s.positions, ev.position, 100) : s.positions.filter((p) => p.id !== ev.position.id),
      }));
    case 'stats.updated':
      return set({ stats: ev.stats });
    case 'wallet.updated':
      return set({ wallet: { ...ev.wallet, extra: ev.wallet.extra ?? [] } });
    case 'system.health':
      return set({ health: ev.health });
    case 'error':
      return set((s) => ({
        recentErrors: [ev.error, ...s.recentErrors].slice(0, 50),
        health: s.health && ev.error.level === 'error' ? { ...s.health, unacknowledgedErrors: s.health.unacknowledgedErrors + 1 } : s.health,
      }));
    case 'settings.updated':
      return set({ settings: ev.settings });
    case 'risk.breach':
      return toast(`Limit ryzyka: ${ev.reason}`, 'warn', 8000);
  }
}

export async function loadState(): Promise<void> {
  const snap = await api.get<AppStateSnapshot & { meta: Meta }>('/api/state');
  set((s) => ({
    ...snap,
    // starszy serwer (sprzed portfeli handlowych) nie wysyła `extra` — panel nie może się na tym wywrócić
    wallet: { ...snap.wallet, extra: snap.wallet?.extra ?? [] },
    settings: { ...snap.settings, trading: { ...snap.settings.trading, maxPositionsPerWallet: snap.settings.trading.maxPositionsPerWallet ?? 0 } },
    loaded: true,
    // serwer ma nowszą wersję panelu niż ta załadowana w karcie (np. po aktualizacji i restarcie)
    updateAvailable: s.updateAvailable || (!!s.meta.buildId && !!snap.meta.buildId && s.meta.buildId !== snap.meta.buildId),
    meta: s.meta.buildId ? { ...snap.meta, buildId: s.meta.buildId } : snap.meta,
    scenarioHistory: snap.market.analysis ? pushScenario({ ...s, scenarioHistory: [] }, snap.market.analysis) : [],
  }));
}

let source: EventSource | null = null;
export function connectStream(): void {
  source?.close();
  source = new EventSource('/api/stream');
  source.onopen = () => {
    set({ connected: true });
    void loadState().catch(() => undefined); // resynchronizacja po (ponownym) połączeniu
  };
  source.onerror = () => set({ connected: false });
  source.onmessage = (msg) => {
    try {
      applyEvent(JSON.parse(msg.data) as StreamEvent);
    } catch {
      // uszkodzona wiadomość — pomijamy
    }
  };
}

export function disconnectStream(): void {
  source?.close();
  source = null;
  set({ connected: false });
}
