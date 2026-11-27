import type { FastifyInstance } from 'fastify';
import type { StreamEvent } from '../../../shared/types.ts';
import type { AppContext } from '../app.ts';
import type { BusEventName, BusEvents } from '../core/eventBus.ts';

function toStreamEvent<K extends BusEventName>(ctx: AppContext, name: K, payload: BusEvents[K]): StreamEvent | null {
  switch (name) {
    case 'market.tick': {
      const p = payload as BusEvents['market.tick'];
      return { type: 'market.tick', snapshot: p.snapshot, candle: p.candle };
    }
    case 'market.candles': {
      const p = payload as BusEvents['market.candles'];
      return { type: 'market.candles', candles: p.candles, replace: p.replace };
    }
    case 'market.analysis':
      return { type: 'market.analysis', analysis: payload as BusEvents['market.analysis'] };
    case 'market.feed':
      return { type: 'market.feed', feed: payload as BusEvents['market.feed'] };
    case 'bot.state':
      return { type: 'bot.state', bot: payload as BusEvents['bot.state'] };
    case 'session.updated': {
      const p = payload as BusEvents['session.updated'];
      return { type: 'session.updated', session: p.session, token: p.token };
    }
    case 'order.updated':
      return { type: 'order.updated', order: payload as BusEvents['order.updated'] };
    case 'trade.executed':
      return { type: 'trade.executed', trade: (payload as BusEvents['trade.executed']).trade };
    case 'position.updated': {
      const pos = payload as BusEvents['position.updated'];
      const [marked] = ctx.stats.withMarks([pos], ctx.market.snapshot?.priceSol, ctx.market.solUsdNow());
      return { type: 'position.updated', position: marked! };
    }
    case 'stats.updated':
      return { type: 'stats.updated', stats: payload as BusEvents['stats.updated'] };
    case 'wallet.updated':
      return { type: 'wallet.updated', wallet: payload as BusEvents['wallet.updated'] };
    case 'system.health':
      return { type: 'system.health', health: payload as BusEvents['system.health'] };
    case 'error':
      return { type: 'error', error: payload as BusEvents['error'] };
    case 'settings.updated':
      return { type: 'settings.updated', settings: payload as BusEvents['settings.updated'] };
    case 'risk.breach': {
      const p = payload as BusEvents['risk.breach'];
      return { type: 'risk.breach', reason: p.reason, action: p.action };
    }
    default:
      return null;
  }
}

/** Strumień zdarzeń dla panelu (Server-Sent Events). */
export function registerStream(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const off = ctx.bus.onAny((name, payload) => {
      const ev = toStreamEvent(ctx, name, payload);
      if (ev && !res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    });
    const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);
    ctx.health.sseClients++;
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
      ctx.health.sseClients--;
    });
  });
}
