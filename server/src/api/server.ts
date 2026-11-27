import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyRequest } from 'fastify';
import type { AppContext } from '../app.ts';
import { logger } from '../core/logger.ts';
import { UserError } from '../core/util.ts';
import { registerRoutes } from './routes.ts';
import { registerStream } from './stream.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** Nazwy hosta, pod którymi panel jest dostępny (ochrona przed DNS rebinding — obca strona podszywająca się pod localhost). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalHostHeader(req: FastifyRequest): boolean {
  const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  return LOCAL_HOSTS.has(host);
}

export function isLoopback(req: FastifyRequest): boolean {
  return LOOPBACK.has(req.ip);
}

export async function buildServer(ctx: AppContext) {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: ctx.env.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    );
    // Panel nie ma haseł — dlatego działa wyłącznie na tym komputerze (połączenie z 127.0.0.1 i adres localhost).
    if (!isLoopback(req) || !isLocalHostHeader(req)) {
      return reply.status(403).type('text/plain; charset=utf-8').send('SolDesk działa bez hasła, więc jest dostępny tylko z komputera, na którym jest uruchomiony (http://127.0.0.1).');
    }
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    // ochrona CSRF: zmiany stanu wymagają własnego nagłówka (formularze z obcych stron go nie wyślą)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'soldesk') {
      return reply.status(403).send({ error: 'Brak nagłówka X-Requested-With' });
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/stream')) {
      logger.debug({ method: req.method, url: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'http');
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof UserError) return reply.status(err.status).send({ error: err.message });
    if (err.validation || (err.statusCode && err.statusCode < 500)) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
    ctx.errors.record('api', err, { context: { method: req.method, url: req.url.split('?')[0] } });
    return reply.status(500).send({ error: 'Błąd serwera — szczegóły w Ustawienia → Monitoring' });
  });

  registerStream(app, ctx);
  registerRoutes(app, ctx);

  if (fs.existsSync(ctx.env.webDist)) {
    // wildcard (domyślny): pliki czytane z dysku przy każdym żądaniu, więc nowy build panelu działa bez restartu serwera
    await app.register(fastifyStatic, { root: ctx.env.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Nie znaleziono' });
      // brakujący plik JS/CSS z innego buildu: 404 zamiast index.html (inaczej przeglądarka pokazuje pustą stronę)
      if (req.url.startsWith('/assets/')) return reply.status(404).type('text/plain').send('Nie znaleziono');
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Nie znaleziono' });
      return reply
        .type('text/html')
        .send('<p style="font-family:sans-serif">Panel nie jest zbudowany. Uruchom <code>npm run build</code> albo tryb deweloperski <code>npm run dev</code>.</p>');
    });
  }
  return app;
}
