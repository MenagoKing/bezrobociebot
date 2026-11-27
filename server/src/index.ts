import { buildServer } from './api/server.ts';
import { createApp, startServices, stopServices } from './app.ts';
import { env } from './config/env.ts';
import { logger, sanitize } from './core/logger.ts';
import { errorMessage } from './core/util.ts';

const ctx = createApp();

process.on('unhandledRejection', (reason) => {
  ctx.errors.record('process.unhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
  // stan jest w bazie; po restarcie (Docker/systemd) sesja wróci jako wstrzymana
  logger.fatal({ err: sanitize(errorMessage(err)), stack: sanitize(err.stack ?? '') }, 'nieprzechwycony wyjątek — zamykanie');
  try {
    ctx.errors.record('process.uncaughtException', err);
    stopServices(ctx);
    ctx.db.close();
  } finally {
    process.exit(1);
  }
});

await startServices(ctx);
const app = await buildServer(ctx);
await app.listen({ port: env.port, host: env.host });
logger.info(
  { url: `http://${env.host}:${env.port}`, live: env.liveTradingEnabled },
  'SolDesk uruchomiony',
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'zamykanie…');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    stopServices(ctx);
    await app.close();
    ctx.db.close();
  } catch (err) {
    logger.error({ err: errorMessage(err) }, 'błąd przy zamykaniu');
  }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
