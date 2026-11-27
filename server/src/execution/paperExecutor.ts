import type { Order, Position } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import { RetryableError, sleep } from '../core/util.ts';
import type { MarketService } from '../market/marketService.ts';
import type { ChainRegistry } from '../chains/chainRegistry.ts';
import type { ExecContext, Executor, Fill } from './executor.ts';

/**
 * Symulowane wykonanie po bieżącej cenie rynkowej z uwzględnieniem poślizgu,
 * prowizji platformy, opłat sieci i rentu za konto tokena.
 */
export class PaperExecutor implements Executor {
  readonly mode = 'paper' as const;
  private market: MarketService;
  private settings: SettingsService;
  private chains: ChainRegistry;

  constructor(market: MarketService, settings: SettingsService, chains: ChainRegistry) {
    this.market = market;
    this.settings = settings;
    this.chains = chains;
  }

  private currentPrice(): number {
    const maxAge = this.settings.get().risk.maxDataAgeSeconds;
    const snap = this.market.snapshot;
    if (!snap || !this.market.isFresh(maxAge) || !(snap.priceSol > 0)) {
      throw new RetryableError('Brak aktualnej ceny rynkowej');
    }
    return snap.priceSol;
  }

  private networkFee(chain: string): number {
    return this.chains.networkFeeEstimate(chain);
  }

  async buy(ctx: ExecContext, valueSol: number): Promise<Fill> {
    await sleep(250 + Math.random() * 450); // symulowane opóźnienie sieci
    const t = this.settings.get().trading;
    const market = this.currentPrice();
    const fillPrice = market * (1 + t.paperSlippagePct / 100);
    const feeSol = valueSol * (t.paperPlatformFeePct / 100);
    const amount = (valueSol - feeSol) / fillPrice;
    return {
      amount,
      decimals: 6,
      valueSol,
      feeSol,
      networkFeeSol: this.networkFee(ctx.session.chain),
      rentSol: this.chains.firstBuyRent(ctx.session, ctx.firstBuyOnWallet),
      priceSol: valueSol / amount,
      marketPriceSol: market,
      txSignature: null,
    };
  }

  async sell(ctx: ExecContext, position: Position): Promise<Fill> {
    await sleep(250 + Math.random() * 450);
    const t = this.settings.get().trading;
    const market = this.currentPrice();
    const fillPrice = market * (1 - t.paperSlippagePct / 100);
    const gross = position.amount * fillPrice;
    const feeSol = gross * (t.paperPlatformFeePct / 100);
    const valueSol = gross - feeSol;
    return {
      amount: position.amount,
      decimals: position.decimals,
      valueSol,
      feeSol,
      networkFeeSol: this.networkFee(ctx.session.chain),
      rentSol: 0,
      priceSol: valueSol / position.amount,
      marketPriceSol: market,
      txSignature: null,
    };
  }

  async reconcile(_ctx: ExecContext, _order: Order): Promise<Fill | null> {
    return null; // symulacja przerwana restartem po prostu się nie wykonała
  }
}
