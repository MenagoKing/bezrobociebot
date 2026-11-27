import type { Hex } from 'viem';
import { MAIN_WALLET_ID, SOLANA, type EvmWalletInfo, type ExtraWalletInfo, type WalletInfo } from '../../../shared/types.ts';
import type { ChainRegistry } from '../chains/chainRegistry.ts';
import type { SettingsService } from '../config/settingsService.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import type { EventBus } from '../core/eventBus.ts';
import { errorMessage } from '../core/util.ts';
import { ERC20_ABI, type EvmClients } from '../evm/evmClients.ts';
import type { MarketService } from '../market/marketService.ts';
import type { SolanaRpc } from '../solana/rpc.ts';
import type { AccountService } from './accountService.ts';

/**
 * Monitor portfeli (tylko odczyt, adresy publiczne): saldo SOL i tokena sesji przez RPC Solany
 * oraz saldo waluty natywnej i tokena na sieci EVM (sieć bieżącej sesji albo pierwsza włączona).
 */
export class WalletMonitor {
  state: WalletInfo = { address: null, solBalance: null, tokenBalance: null, tokenMint: null, solUsd: 0, updatedAt: null, error: null, evm: null, extra: [] };
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;

  private bus: EventBus;
  private rpc: SolanaRpc;
  private account: AccountService;
  private market: MarketService;
  private settings: SettingsService;
  private errors: ErrorMonitor;
  private chains: ChainRegistry;
  private evmClients: EvmClients;

  constructor(deps: {
    bus: EventBus;
    rpc: SolanaRpc;
    account: AccountService;
    market: MarketService;
    settings: SettingsService;
    errors: ErrorMonitor;
    chains: ChainRegistry;
    evmClients: EvmClients;
  }) {
    this.bus = deps.bus;
    this.rpc = deps.rpc;
    this.account = deps.account;
    this.market = deps.market;
    this.settings = deps.settings;
    this.errors = deps.errors;
    this.chains = deps.chains;
    this.evmClients = deps.evmClients;
  }

  start(): void {
    const loop = async () => {
      await this.refresh();
      this.timer = setTimeout(loop, this.settings.get().system.walletPollSec * 1000);
    };
    void loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  /** Sieć EVM do monitorowania: sieć bieżącego tokena albo pierwsza włączona. */
  private evmChain(): string | null {
    const tokenChain = this.market.token?.chain;
    if (tokenChain && tokenChain !== SOLANA) return tokenChain;
    return this.chains.enabledEvm()[0]?.key ?? null;
  }

  private async solana(): Promise<Omit<WalletInfo, 'evm' | 'extra'>> {
    const address = this.account.get().walletAddress || null;
    const solUsd = await this.market.getNativeUsd(SOLANA);
    if (!address) return { address: null, solBalance: null, tokenBalance: null, tokenMint: null, solUsd, updatedAt: Date.now(), error: null };
    try {
      const lamports = await this.rpc.getBalanceLamports(address);
      const token = this.market.token;
      const mint = token && token.chain === SOLANA && this.market.feed.source === 'live' ? token.address : null;
      const bal = mint ? await this.rpc.getTokenBalance(address, mint) : null;
      return { address, solBalance: lamports / 1e9, tokenBalance: bal ? bal.ui : null, tokenMint: mint, solUsd, updatedAt: Date.now(), error: null };
    } catch (err) {
      this.errors.record('wallet.solana', err, { level: 'warn', throttleMs: 300_000 });
      return { ...this.state, address, solUsd, error: errorMessage(err) };
    }
  }

  private async evm(): Promise<EvmWalletInfo | null> {
    const address = this.account.get().evmWalletAddress;
    const chain = this.evmChain();
    if (!address || !chain) return null;
    const nativeSymbol = this.chains.nativeSymbol(chain);
    const nativeUsd = await this.market.getNativeUsd(chain);
    try {
      const pub = this.evmClients.public(chain);
      const wei = await pub.getBalance({ address: address as Hex });
      const token = this.market.token;
      let tokenBalance: number | null = null;
      if (token && token.chain === chain && this.market.feed.source === 'live') {
        const [raw, dec] = await Promise.all([
          pub.readContract({ address: token.address as Hex, abi: ERC20_ABI, functionName: 'balanceOf', args: [address as Hex] }),
          pub.readContract({ address: token.address as Hex, abi: ERC20_ABI, functionName: 'decimals' }),
        ]);
        tokenBalance = Number(raw) / 10 ** Number(dec);
      }
      return { address, chain, nativeSymbol, nativeBalance: Number(wei) / 1e18, tokenBalance, nativeUsd, error: null };
    } catch (err) {
      this.errors.record('wallet.evm', err, { level: 'warn', throttleMs: 300_000 });
      return { address, chain, nativeSymbol, nativeBalance: this.state.evm?.nativeBalance ?? null, tokenBalance: null, nativeUsd, error: errorMessage(err) };
    }
  }

  /** Dodatkowe portfele handlowe: Solana przez RPC, EVM na monitorowanej sieci. */
  private async extras(): Promise<ExtraWalletInfo[]> {
    const evmChain = this.evmChain();
    const token = this.market.token;
    const liveFeed = this.market.feed.source === 'live';
    return Promise.all(
      this.account.get().tradingWallets.map(async (w): Promise<ExtraWalletInfo> => {
        const chain = w.kind === 'solana' ? SOLANA : evmChain;
        const base: ExtraWalletInfo = {
          id: w.id,
          kind: w.kind,
          label: w.label,
          address: w.address,
          chain: chain ?? '',
          nativeSymbol: chain ? this.chains.nativeSymbol(chain) : 'ETH',
          nativeBalance: null,
          tokenBalance: null,
          error: null,
        };
        if (!chain) return { ...base, error: 'brak włączonej sieci EVM' };
        const withToken = !!token && token.chain === chain && liveFeed;
        try {
          if (w.kind === 'solana') {
            const lamports = await this.rpc.getBalanceLamports(w.address);
            const bal = withToken ? await this.rpc.getTokenBalance(w.address, token.address) : null;
            return { ...base, nativeBalance: lamports / 1e9, tokenBalance: bal ? bal.ui : null };
          }
          const pub = this.evmClients.public(chain);
          const wei = await pub.getBalance({ address: w.address as Hex });
          let tokenBalance: number | null = null;
          if (withToken) {
            const [raw, dec] = await Promise.all([
              pub.readContract({ address: token.address as Hex, abi: ERC20_ABI, functionName: 'balanceOf', args: [w.address as Hex] }),
              pub.readContract({ address: token.address as Hex, abi: ERC20_ABI, functionName: 'decimals' }),
            ]);
            tokenBalance = Number(raw) / 10 ** Number(dec);
          }
          return { ...base, nativeBalance: Number(wei) / 1e18, tokenBalance };
        } catch (err) {
          this.errors.record('wallet.extra', err, { level: 'warn', throttleMs: 300_000 });
          const prev = this.state.extra.find((x) => x.id === w.id && x.chain === chain);
          return { ...base, nativeBalance: prev?.nativeBalance ?? null, error: errorMessage(err) };
        }
      }),
    );
  }

  private async doRefresh(): Promise<void> {
    const [sol, evm, extra] = await Promise.all([this.solana(), this.evm(), this.extras()]);
    this.state = { ...sol, evm, extra };
    this.bus.emit('wallet.updated', this.state);
  }

  /** Saldo waluty natywnej portfela (0 = główny) na danej sieci (null = nieznane). */
  nativeBalance(chain: string, walletId: number = MAIN_WALLET_ID): number | null {
    if (walletId !== MAIN_WALLET_ID) {
      const x = this.state.extra.find((e) => e.id === walletId);
      return x && x.chain === chain ? x.nativeBalance : null;
    }
    if (chain === SOLANA) return this.state.address ? this.state.solBalance : null;
    return this.state.evm?.chain === chain ? this.state.evm.nativeBalance : null;
  }
}
