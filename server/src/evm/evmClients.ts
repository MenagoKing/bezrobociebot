import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Account, type Chain, type PublicClient, type WalletClient } from 'viem';
import type { ChainRegistry } from '../chains/chainRegistry.ts';

export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

/** Klienci viem per sieć (tworzeni na żądanie, odświeżani po zmianie URL RPC w ustawieniach). */
export class EvmClients {
  private cache = new Map<string, { rpc: string; chain: Chain; client: PublicClient }>();
  private registry: ChainRegistry;

  constructor(registry: ChainRegistry) {
    this.registry = registry;
  }

  chain(key: string): Chain {
    return this.entry(key).chain;
  }

  private entry(key: string) {
    const cfg = this.registry.evm(key);
    const cached = this.cache.get(key);
    if (cached && cached.rpc === cfg.rpcUrl && cached.chain.id === cfg.chainId) return cached;
    const chain = defineChain({
      id: cfg.chainId,
      name: cfg.name,
      nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });
    const client = createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2 }) }) as PublicClient;
    const entry = { rpc: cfg.rpcUrl, chain, client };
    this.cache.set(key, entry);
    return entry;
  }

  public(key: string): PublicClient {
    return this.entry(key).client;
  }

  wallet(key: string, account: Account): WalletClient {
    const { chain, rpc } = this.entry(key);
    return createWalletClient({ account, chain, transport: http(rpc, { timeout: 20_000, retryCount: 0 }) });
  }
}
