import { EventEmitter } from 'node:events';
import type {
  AppSettings,
  BotSnapshot,
  Callout,
  Candle,
  ErrorEntry,
  FeedHealth,
  HealthInfo,
  MarketAnalysis,
  MarketSnapshot,
  Order,
  Position,
  SessionRecord,
  SessionStats,
  TokenInfo,
  Trade,
  WalletInfo,
} from '../../../shared/types.ts';

export interface BusEvents {
  'market.tick': { snapshot: MarketSnapshot; candle: Candle | null };
  'market.candles': { candles: Candle[]; replace: boolean };
  'market.analysis': MarketAnalysis;
  'market.feed': FeedHealth;
  'bot.state': BotSnapshot;
  'session.updated': { session: SessionRecord | null; token: TokenInfo | null };
  'order.updated': Order;
  'trade.executed': { trade: Trade; position: Position; session: SessionRecord };
  'position.updated': Position;
  'stats.updated': SessionStats | null;
  'callout.updated': Callout;
  'wallet.updated': WalletInfo;
  'system.health': HealthInfo;
  error: ErrorEntry;
  'settings.updated': AppSettings;
  'risk.breach': { reason: string; action: string };
}

export type BusEventName = keyof BusEvents;
type Handler<K extends BusEventName> = (payload: BusEvents[K]) => void | Promise<void>;

/**
 * Typowana szyna zdarzeń. Błąd w jednym subskrybencie nie przerywa pozostałych
 * ani emitera — trafia do `onHandlerError` (monitor błędów).
 */
export class EventBus {
  private emitter = new EventEmitter();
  onHandlerError: ((event: string, err: unknown) => void) | null = null;

  constructor() {
    this.emitter.setMaxListeners(200);
    // EventEmitter rzuca wyjątek przy emit('error') bez słuchaczy — u nas 'error' to zwykłe zdarzenie domenowe
    this.emitter.on('error', () => undefined);
  }

  on<K extends BusEventName>(event: K, handler: Handler<K>): () => void {
    const wrapped = (payload: BusEvents[K]) => {
      try {
        const result = handler(payload);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => this.onHandlerError?.(event, err));
        }
      } catch (err) {
        this.onHandlerError?.(event, err);
      }
    };
    this.emitter.on(event, wrapped);
    return () => this.emitter.off(event, wrapped);
  }

  /** Subskrypcja wszystkich zdarzeń (np. dla SSE). */
  onAny(handler: <K extends BusEventName>(event: K, payload: BusEvents[K]) => void): () => void {
    const offs = ALL_EVENTS.map((name) => this.on(name, (p) => handler(name, p)));
    return () => offs.forEach((off) => off());
  }

  emit<K extends BusEventName>(event: K, payload: BusEvents[K]): void {
    this.emitter.emit(event, payload);
  }
}

const ALL_EVENTS: BusEventName[] = [
  'market.tick',
  'market.candles',
  'market.analysis',
  'market.feed',
  'bot.state',
  'session.updated',
  'order.updated',
  'trade.executed',
  'position.updated',
  'stats.updated',
  'callout.updated',
  'wallet.updated',
  'system.health',
  'error',
  'settings.updated',
  'risk.breach',
];
