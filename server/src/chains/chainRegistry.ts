import { SOLANA, type EvmChainConfig, type SessionRecord } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import { UserError } from '../core/util.ts';

/**
 * Wiedza o sieciach w jednym miejscu: Solana vs EVM, waluta natywna, szacunek opłat,
 * rezerwa na gaz i rent (tylko Solana). Konfiguracja sieci EVM pochodzi z ustawień (sekcja „evm”).
 */
export class ChainRegistry {
  private settings: SettingsService;

  constructor(settings: SettingsService) {
    this.settings = settings;
  }

  isSolana(chain: string): boolean {
    return chain === SOLANA;
  }

  /** Konfiguracja sieci EVM (także wyłączonej — przydaje się dla sesji historycznych). */
  evmConfig(chain: string): EvmChainConfig | null {
    return this.settings.get().evm.chains.find((c) => c.key === chain) ?? null;
  }

  /** Konfiguracja włączonej sieci EVM albo błąd czytelny dla użytkownika. */
  evm(chain: string): EvmChainConfig {
    const cfg = this.evmConfig(chain);
    if (!cfg) throw new UserError(`Sieć „${chain}” nie jest skonfigurowana (Ustawienia → Sieci i połączenia)`);
    if (!cfg.enabled) throw new UserError(`Sieć ${cfg.name} jest wyłączona (Ustawienia → Sieci i połączenia)`);
    return cfg;
  }

  enabledEvm(): EvmChainConfig[] {
    return this.settings.get().evm.chains.filter((c) => c.enabled);
  }

  nativeSymbol(chain: string): string {
    return this.isSolana(chain) ? 'SOL' : (this.evmConfig(chain)?.nativeSymbol ?? 'ETH');
  }

  /** Szacowana opłata sieci za jedną transakcję (w walucie natywnej). */
  networkFeeEstimate(chain: string): number {
    const t = this.settings.get().trading;
    if (this.isSolana(chain)) return t.paperNetworkFeeSol + t.priorityFeeLamports / 1e9;
    return this.evmConfig(chain)?.paperGasFeeNative ?? 0;
  }

  /** Rezerwa waluty natywnej, której bot nie wydaje (na opłaty). */
  gasReserve(chain: string): number {
    if (this.isSolana(chain)) return this.settings.get().risk.solReserve;
    return this.evmConfig(chain)?.gasReserveNative ?? 0;
  }

  /** Rent za konto tokena przy pierwszym zakupie — istnieje tylko na Solanie. */
  firstBuyRent(session: SessionRecord, firstBuyOnWallet: boolean): number {
    if (!this.isSolana(session.chain) || !firstBuyOnWallet) return 0;
    return this.settings.get().trading.paperAtaRentSol;
  }

  simulatedNativeUsd(chain: string): number {
    if (this.isSolana(chain)) return this.settings.get().system.simulatedSolUsd;
    return this.evmConfig(chain)?.simulatedNativeUsd ?? 1700;
  }
}
