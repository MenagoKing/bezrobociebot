import path from 'node:path';
import { env } from './config/env.ts';
import { SettingsService } from './config/settingsService.ts';
import { Coordinator } from './coordinator/coordinator.ts';
import { RiskManager } from './coordinator/riskManager.ts';
import { ErrorMonitor } from './core/errorMonitor.ts';
import { EventBus } from './core/eventBus.ts';
import { logger, sanitize } from './core/logger.ts';
import { errorMessage } from './core/util.ts';
import { Db } from './db/database.ts';
import { Repository } from './db/repository.ts';
import { BotEngine } from './engine/botEngine.ts';
import { Ledger } from './engine/ledger.ts';
import { OrderQueue } from './engine/orderQueue.ts';
import { JupiterExecutor } from './execution/jupiterExecutor.ts';
import { PaperExecutor } from './execution/paperExecutor.ts';
import { MarketService } from './market/marketService.ts';
import { Vault } from './security/vault.ts';
import { AccountService } from './services/accountService.ts';
import { BackupService } from './services/backupService.ts';
import { HealthMonitor } from './services/healthMonitor.ts';
import { StatsService } from './services/statsService.ts';
import { WalletMonitor } from './services/walletMonitor.ts';
import { SolanaRpc } from './solana/rpc.ts';
import { ChainRegistry } from './chains/chainRegistry.ts';
import { EvmClients } from './evm/evmClients.ts';
import { EvmExecutor } from './execution/evmExecutor.ts';

/** Kontener zależności — jedno miejsce, w którym moduły są tworzone i łączone. */
export function createApp(opts: { dbFile?: string } = {}) {
  const dbFile = opts.dbFile ?? path.join(env.dataDir, 'soldesk.db');
  const db = new Db(dbFile);
  db.migrate();
  const repo = new Repository(db);
  const bus = new EventBus();
  const errors = new ErrorMonitor(repo, bus);
  bus.onHandlerError = (event, err) => errors.record(`bus:${event}`, err);

  const settings = new SettingsService(repo, bus, (msg) => logger.warn(msg));
  const vault = Vault.load(env.masterKey, env.dataDir, (msg) => logger.warn(msg));
  const account = new AccountService(repo, vault, settings, errors);
  const rpc = new SolanaRpc(() => account.rpcUrl());
  const chains = new ChainRegistry(settings);
  const evmClients = new EvmClients(chains);
  const market = new MarketService(bus, settings, errors, chains);
  const stats = new StatsService(repo, market);
  const ledger = new Ledger(repo);

  const paper = new PaperExecutor(market, settings, chains);
  const live = new JupiterExecutor(rpc, settings, () => account.getKeypair());
  const evmLive = new EvmExecutor({ registry: chains, clients: evmClients, settings, getAccount: () => account.getEvmAccount(), lifiApiKey: () => account.lifiApiKey() });
  const queue = new OrderQueue({
    repo,
    bus,
    errors,
    settings,
    ledger,
    market,
    getExecutor: (session) => {
      if (session.mode === 'paper') return paper;
      if (!env.liveTradingEnabled) throw new Error('Tryb live wyłączony na serwerze');
      return chains.isSolana(session.chain) ? live : evmLive;
    },
  });
  const risk = new RiskManager(settings, repo, chains);
  const wallet = new WalletMonitor({ bus, rpc, account, market, settings, errors, chains, evmClients });

  // engine potrzebuje salda, które zna koordynator — wiązanie przez referencję
  let coordinator: Coordinator | null = null;
  const engine = new BotEngine({
    bus,
    repo,
    settings,
    market,
    queue,
    risk,
    stats,
    errors,
    getBalanceSol: (s) => coordinator?.balanceSol(s) ?? null,
  });
  coordinator = new Coordinator({ bus, repo, settings, market, queue, risk, engine, stats, errors, wallet, account, rpc, chains, evmClients });
  const health = new HealthMonitor(bus, repo, market, dbFile);
  const backup = new BackupService(db, repo, settings, errors, env.dataDir);

  return { env, db, repo, bus, errors, settings, vault, account, rpc, chains, evmClients, market, stats, queue, risk, wallet, engine, coordinator, health, backup };
}

export type AppContext = ReturnType<typeof createApp>;

export async function startServices(ctx: AppContext): Promise<void> {
  await ctx.coordinator.init();
  ctx.wallet.start();
  ctx.health.start();
  ctx.backup.start();
  setInterval(() => {
    try {
      ctx.repo.pruneErrors();
    } catch (err) {
      logger.warn({ err: sanitize(errorMessage(err)) }, 'sprzątanie bazy nieudane');
    }
  }, 3600_000).unref();
}

export function stopServices(ctx: AppContext): void {
  ctx.coordinator.shutdown();
  ctx.wallet.stop();
  ctx.health.stop();
  ctx.backup.stop();
}
