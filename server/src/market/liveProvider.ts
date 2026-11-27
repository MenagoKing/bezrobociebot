import { SOLANA, type Candle, type MarketSnapshot, type TokenInfo, type TokenSearchResult } from '../../../shared/types.ts';
import type { ChainRegistry } from '../chains/chainRegistry.ts';
import { RetryableError, UserError, fetchJson, sleep } from '../core/util.ts';
import { WSOL_MINT, type MarketProvider } from './provider.ts';

const DEX = 'https://api.dexscreener.com/latest/dex';
const GECKO = 'https://api.geckoterminal.com/api/v2/networks';
const STABLES = ['USDC', 'USDT', 'USDG', 'DAI', 'USDC.E', 'USDBC'];

interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: { m5?: { buys: number; sells: number } };
  volume?: { m5?: number; h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
  pairCreatedAt?: number;
}

const GECKO_TF: Record<number, [string, number]> = {
  60: ['minute', 1],
  300: ['minute', 5],
  900: ['minute', 15],
  3600: ['hour', 1],
  14400: ['hour', 4],
  43200: ['hour', 12],
  86400: ['day', 1],
};
// interwały sekundowe GeckoTerminal są tylko w płatnym planie — budujemy je z własnego feedu cen (chartCandles)

/**
 * Wspólna kolejka zapytań do GeckoTerminal (darmowy limit ~30/min dla całej aplikacji: bot, wykres, podgląd).
 * Zapytania idą po kolei z odstępem; po 429 albo awarii robimy przerwę i ponawiamy (maks. 2 razy).
 */
const GECKO_GAP_MS = 2200;
let geckoQueue: Promise<unknown> = Promise.resolve();
let geckoNextAt = 0;
function geckoGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const wait = geckoNextAt - Date.now();
      if (wait > 0) await sleep(wait);
      geckoNextAt = Date.now() + GECKO_GAP_MS;
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof RetryableError) || attempt >= 2) throw err;
        geckoNextAt = Date.now() + (/429/.test(err.message) ? 6000 : 2500) * (attempt + 1);
      }
    }
  };
  const p = geckoQueue.then(run, run);
  geckoQueue = p.catch(() => undefined);
  return p;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const liq = (p: DexPair) => p.liquidity?.usd ?? 0;

/**
 * Dane rzeczywiste dla Solany i sieci EVM: DexScreener (cena/płynność/wolumen)
 * + GeckoTerminal (świece OHLCV). Kurs waluty natywnej z najpłynniejszej pary ze stablecoinem.
 */
export class LiveMarketProvider implements MarketProvider {
  readonly source = 'live' as const;
  private priceCache = new Map<string, { value: number; at: number }>();
  private chains: ChainRegistry;

  constructor(chains: ChainRegistry) {
    this.chains = chains;
  }

  private async tokenPairs(address: string): Promise<DexPair[]> {
    const data = await fetchJson<{ pairs: DexPair[] | null }>(`${DEX}/tokens/${address}`);
    return data.pairs ?? [];
  }

  /** Cena tokena w USD z najpłynniejszej pary ze stablecoinem na danej sieci (z cache 60 s). */
  private async tokenUsd(chain: string, address: string): Promise<number> {
    const key = `${chain}:${address.toLowerCase()}`;
    const hit = this.priceCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const pairs = (await this.tokenPairs(address)).filter(
      (p) => p.chainId === chain && same(p.baseToken.address, address) && STABLES.includes(p.quoteToken.symbol.toUpperCase()),
    );
    const best = pairs.sort((a, b) => liq(b) - liq(a))[0];
    const price = Number(best?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Nie udało się wycenić ${address} na ${chain}`);
    this.priceCache.set(key, { value: price, at: Date.now() });
    return price;
  }

  async getNativeUsd(chain: string): Promise<number> {
    if (chain === SOLANA) return this.tokenUsd(SOLANA, WSOL_MINT);
    const ref = this.chains.evmConfig(chain)?.nativePriceRef;
    if (!ref) throw new Error(`Brak wyceny waluty natywnej dla sieci ${chain}`);
    const [refChain, refAddress] = ref.split(':') as [string, string];
    return this.tokenUsd(refChain, refAddress);
  }

  /** Kurs waluty natywnej dla pary (Solana: z ceny w SOL, gdy para jest do WSOL). */
  private async nativeUsdFor(pair: DexPair, chain: string): Promise<number> {
    const priceUsd = Number(pair.priceUsd ?? 0);
    const native = Number(pair.priceNative ?? 0);
    if (chain === SOLANA && pair.quoteToken.address === WSOL_MINT && native > 0 && priceUsd > 0) return priceUsd / native;
    return this.getNativeUsd(chain);
  }

  private pickPair(pairs: DexPair[], address: string, chain: string): DexPair | null {
    const own = pairs.filter((p) => p.chainId === chain && same(p.baseToken.address, address));
    if (!own.length) return null;
    const solPairs = chain === SOLANA ? own.filter((p) => p.quoteToken.address === WSOL_MINT) : [];
    const pool = solPairs.length ? solPairs : own;
    return pool.reduce((best, p) => (liq(p) > liq(best) ? p : best));
  }

  private async toToken(pair: DexPair, chain: string): Promise<TokenInfo> {
    const priceUsd = Number(pair.priceUsd ?? 0);
    const nativeUsd = await this.nativeUsdFor(pair, chain);
    return {
      address: pair.baseToken.address,
      chain,
      nativeSymbol: this.chains.nativeSymbol(chain),
      name: pair.baseToken.name,
      symbol: pair.baseToken.symbol,
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
      quoteSymbol: pair.quoteToken.symbol,
      url: pair.url,
      imageUrl: pair.info?.imageUrl,
      priceUsd,
      priceSol: nativeUsd > 0 ? priceUsd / nativeUsd : 0,
      liquidityUsd: liq(pair),
      volume24hUsd: pair.volume?.h24 ?? 0,
      marketCapUsd: pair.marketCap ?? pair.fdv ?? 0,
    };
  }

  private wrongChainError(pairs: DexPair[], address: string, expected: string): UserError {
    const found = [...new Set(pairs.filter((p) => same(p.baseToken.address, address)).map((p) => p.chainId))];
    if (!found.length) return new UserError('Nie znaleziono tokena na DexScreener (sprawdź adres kontraktu).', 404);
    const symbol = pairs.find((p) => same(p.baseToken.address, address))?.baseToken.symbol ?? '';
    const configured = found.map((c) => this.chains.evmConfig(c)).filter((c) => c && !c.enabled);
    const hint = configured.length
      ? ` Włącz sieć ${configured.map((c) => c!.name).join(', ')} w Ustawienia → Sieci i połączenia.`
      : ' Ta sieć nie jest skonfigurowana — możesz ją dodać w Ustawienia → Sieci i połączenia.';
    return new UserError(`Token ${symbol} jest na sieci: ${found.join(', ')} (oczekiwano: ${expected}).${hint}`, 422);
  }

  /**
   * Wyszukiwanie po nazwie, symbolu lub fragmencie adresu (DexScreener /search).
   * Zwraca tokeny z obsługiwanych sieci (Solana + włączone sieci EVM), po jednym na token — z najpłynniejszej pary.
   */
  async search(query: string, limit = 12): Promise<TokenSearchResult[]> {
    const data = await fetchJson<{ pairs: DexPair[] | null }>(`${DEX}/search?q=${encodeURIComponent(query)}`);
    const allowed = new Set([SOLANA, ...this.chains.enabledEvm().map((c) => c.key)]);
    const best = new Map<string, DexPair>();
    for (const p of data.pairs ?? []) {
      if (!allowed.has(p.chainId)) continue;
      // pomijamy pary, w których szukany token jest tylko walutą kwotowania (np. SOL, USDC)
      if (p.baseToken.address === WSOL_MINT || STABLES.includes(p.baseToken.symbol.toUpperCase())) continue;
      const key = `${p.chainId}:${p.baseToken.address.toLowerCase()}`;
      const cur = best.get(key);
      if (!cur || liq(p) > liq(cur)) best.set(key, p);
    }
    // najpierw obrót z 24 h (trudno go podrobić, w przeciwieństwie do samej płynności), potem płynność
    const vol = (p: DexPair) => p.volume?.h24 ?? 0;
    return [...best.values()]
      .sort((a, b) => vol(b) - vol(a) || liq(b) - liq(a))
      .slice(0, limit)
      .map((p) => ({
        address: p.baseToken.address,
        chain: p.chainId,
        name: p.baseToken.name,
        symbol: p.baseToken.symbol,
        imageUrl: p.info?.imageUrl,
        dexId: p.dexId,
        priceUsd: Number(p.priceUsd ?? 0),
        liquidityUsd: liq(p),
        marketCapUsd: p.marketCap ?? p.fdv ?? 0,
        volume24hUsd: p.volume?.h24 ?? 0,
        createdAt: p.pairCreatedAt ?? null,
      }));
  }

  async resolveToken(address: string, chain: string): Promise<TokenInfo> {
    const pairs = await this.tokenPairs(address);
    const pair = this.pickPair(pairs, address, chain);
    if (!pair) throw this.wrongChainError(pairs, address, chain);
    return this.toToken(pair, chain);
  }

  /** Token EVM: wybiera włączoną sieć, na której token ma największą płynność. */
  async resolveEvmToken(address: string): Promise<TokenInfo> {
    const pairs = await this.tokenPairs(address);
    const enabled = new Set(this.chains.enabledEvm().map((c) => c.key));
    const candidates = pairs.filter((p) => enabled.has(p.chainId) && same(p.baseToken.address, address));
    if (!candidates.length) throw this.wrongChainError(pairs, address, [...enabled].join(', ') || 'brak włączonych sieci EVM');
    const best = candidates.reduce((a, b) => (liq(b) > liq(a) ? b : a));
    return this.toToken(this.pickPair(pairs, address, best.chainId)!, best.chainId);
  }

  async fetchSnapshot(token: TokenInfo): Promise<MarketSnapshot> {
    const data = await fetchJson<{ pairs?: DexPair[] | null; pair?: DexPair | null }>(`${DEX}/pairs/${token.chain}/${token.pairAddress}`);
    const pair = data.pair ?? data.pairs?.[0];
    if (!pair) throw new Error('DexScreener nie zwrócił danych pary');
    const priceUsd = Number(pair.priceUsd ?? 0);
    if (!(priceUsd > 0)) throw new Error('Brak ceny w odpowiedzi DexScreener');
    const nativeUsd = await this.nativeUsdFor(pair, token.chain);
    return {
      ts: Date.now(),
      priceUsd,
      priceSol: priceUsd / nativeUsd,
      solUsd: nativeUsd,
      liquidityUsd: liq(pair),
      volume5mUsd: pair.volume?.m5 ?? 0,
      volume1hUsd: pair.volume?.h1 ?? 0,
      volume24hUsd: pair.volume?.h24 ?? 0,
      buys5m: pair.txns?.m5?.buys ?? 0,
      sells5m: pair.txns?.m5?.sells ?? 0,
      priceChange5mPct: pair.priceChange?.m5 ?? 0,
      priceChange1hPct: pair.priceChange?.h1 ?? 0,
    };
  }

  async fetchCandles(token: TokenInfo, timeframeSec: number, limit: number): Promise<Candle[] | null> {
    const tf = GECKO_TF[timeframeSec];
    const network = token.chain === SOLANA ? 'solana' : this.chains.evmConfig(token.chain)?.geckoNetwork;
    if (!tf || !network) return null;
    try {
      const data = await geckoGate(() => fetchJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
        `${GECKO}/${network}/pools/${token.pairAddress}/ohlcv/${tf[0]}?aggregate=${tf[1]}&limit=${Math.min(limit, 1000)}&currency=usd&token=base`,
        { headers: { accept: 'application/json;version=20230302' }, timeoutMs: 10_000 },
      ));
      const list = data.data?.attributes?.ohlcv_list ?? [];
      return list
        .map(([time, open, high, low, close, volume]) => ({
          time: Number(time),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume),
        }))
        .sort((a, b) => a.time - b.time);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }
}
