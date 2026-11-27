import { useEffect, useState } from 'react';
import { type DataSource, type ExecutionMode, type MarketSnapshot, type TokenInfo, type TokenPreview, type TokenSearchResult } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { TimeframeChart } from '../components/charts.tsx';
import { ConfirmModal, Panel } from '../components/ui.tsx';
import { ExtLink } from '../components/ExtLink.tsx';
import { Playzone } from '../components/Playzone.tsx';
import { chainName, tokenLinks } from '../chains.ts';
import { fmtCompact, fmtPct, fmtPrice, fmtTime, pnlClass, shortAddr } from '../format.ts';
import { toast, useStore } from '../store.ts';
import { Dashboard } from './Overview.tsx';

const PREVIEW_REFRESH_MS = 15_000;

/** CA Solany (base58), adres EVM (0x…) albo link, w którym taki adres występuje. */
function looksLikeAddress(q: string): boolean {
  return /0x[0-9a-fA-F]{40}/.test(q) || /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(q);
}

/** Token z pump.fun (krzywa bondingowa / PumpSwap albo typowy adres kończący się na „pump”). */
function isPumpFun(r: TokenSearchResult): boolean {
  return r.chain === 'solana' && (r.dexId.startsWith('pump') || r.address.endsWith('pump'));
}

/** Logo tokena; gdy brak albo się nie wczyta — pierwsza litera symbolu. */
function TokenAvatar({ url, symbol }: { url?: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="search-result-avatar">{symbol.slice(0, 1).toUpperCase() || '?'}</span>;
  return <img src={url} alt="" onError={() => setFailed(true)} />;
}

/** Wiek pary: „5 min”, „3 h”, „12 d”. */
function fmtAge(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}

/**
 * Nagłówek tokena w górnej części panelu wykresu: nazwa, sieć, CA, linki i dane rynkowe.
 * Gdy jest bieżący snapshot rynku, liczby są na żywo; w przeciwnym razie z chwili wyszukania tokena.
 */
export function TokenHeader({ token, snapshot, actions }: { token: TokenInfo; snapshot?: MarketSnapshot | null; actions?: React.ReactNode }) {
  const price = snapshot?.priceUsd ?? token.priceUsd;
  const liquidity = snapshot?.liquidityUsd ?? token.liquidityUsd;
  const volume = snapshot?.volume24hUsd ?? token.volume24hUsd;
  return (
    <div className="chart-head">
      <div className="chart-head-top">
        <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
          {token.imageUrl && <img src={token.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: '50%', flex: 'none' }} />}
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ fontWeight: 700, fontSize: 18, gap: 8 }}>
              <span>
                {token.name} <span className="muted">({token.symbol})</span>
              </span>
              <span className="badge b-cyan">{chainName(token.chain)}</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <span className="mono small faint" style={{ wordBreak: 'break-all' }}>
                {token.address}
              </span>
              <button className="btn btn-ghost btn-sm" title="Kopiuj CA" onClick={() => void navigator.clipboard.writeText(token.address).then(() => toast('Skopiowano CA', 'ok'))}>
                Kopiuj
              </button>
            </div>
          </div>
        </div>
        <div className="chart-head-links small">
          {tokenLinks(token.chain, token.address).map(([label, url]) => (
            <ExtLink key={label} href={url}>
              {label} ↗
            </ExtLink>
          ))}
          {actions}
        </div>
      </div>
      <div className="ths">
        <div className="ths-item ths-price">
          <div className="ths-label">Cena</div>
          <div className="ths-value">${fmtPrice(price)}</div>
          {snapshot && (
            <div className="ths-chips">
              <span className={`ths-chip ${pnlClass(snapshot.priceChange5mPct)}`} title="Zmiana w ostatnich 5 minutach">
                5m {fmtPct(snapshot.priceChange5mPct)}
              </span>
              <span className={`ths-chip ${pnlClass(snapshot.priceChange1hPct)}`} title="Zmiana w ostatniej godzinie">
                1h {fmtPct(snapshot.priceChange1hPct)}
              </span>
            </div>
          )}
        </div>
        <div className="ths-item">
          <div className="ths-label">Market cap</div>
          <div className="ths-value">${fmtCompact(token.marketCapUsd)}</div>
        </div>
        <div className="ths-item">
          <div className="ths-label">Płynność</div>
          <div className="ths-value">${fmtCompact(liquidity)}</div>
        </div>
        <div className="ths-item">
          <div className="ths-label">Wolumen 24 h</div>
          <div className="ths-value">${fmtCompact(volume)}</div>
          {snapshot && <div className="ths-sub">5 min: ${fmtCompact(snapshot.volume5mUsd)}</div>}
        </div>
        <div className="ths-item">
          <div className="ths-label">Kupna / sprzedaże (5 min)</div>
          {snapshot ? (
            <>
              <div className="ths-value">
                <span className="pos">{snapshot.buys5m}</span>
                <span className="faint"> / </span>
                <span className="neg">{snapshot.sells5m}</span>
              </div>
              <div className="ths-bar" title="Przewaga kupujących (zielone) nad sprzedającymi (czerwone)">
                <div style={{ width: `${snapshot.buys5m + snapshot.sells5m ? (snapshot.buys5m / (snapshot.buys5m + snapshot.sells5m)) * 100 : 50}%` }} />
              </div>
            </>
          ) : (
            <div className="ths-value faint">—</div>
          )}
        </div>
        <div className="ths-item">
          <div className="ths-label">Para</div>
          <div className="ths-value ths-pair">
            {token.dexId} <span className="faint">/</span> {token.quoteSymbol}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Brak sesji: CA → podgląd → zachowanie bota → start
// ---------------------------------------------------------------------------

function Setup() {
  const meta = useStore((s) => s.meta);
  const trading = useStore((s) => s.settings.trading);
  /** to, co wpisuje użytkownik: nazwa, symbol, CA albo link */
  const [query, setQuery] = useState('');
  /** wybrany adres tokena (z wklejonego CA albo kliknięty wynik wyszukiwania) */
  const [address, setAddress] = useState('');
  const [results, setResults] = useState<TokenSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  /** aplikacja produkcyjna: zawsze prawdziwe dane rynkowe */
  const source: DataSource = 'live';
  const [mode, setMode] = useState<ExecutionMode>('paper');
  const [capital, setCapital] = useState(trading.paperStartingCapitalUsd);
  const [phrase, setPhrase] = useState('');
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // wpisany tekst: CA/link → od razu podgląd; nazwa/symbol → lista wyników z DexScreener
  useEffect(() => {
    const q = query.trim();
    if (looksLikeAddress(q)) {
      setResults(null);
      setAddress(q);
      return;
    }
    setAddress('');
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      api
        .get<TokenSearchResult[]>(`/api/token/search?q=${encodeURIComponent(q)}`)
        .then((r) => !cancelled && setResults(r))
        .catch((e) => !cancelled && (setResults([]), setError((e as Error).message)))
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setSearching(false);
    };
  }, [query]);

  // podgląd wybranego tokena (z opóźnieniem) + odświeżanie co 15 s
  useEffect(() => {
    const a = address.trim();
    setPreview(null);
    setError(null);
    if (a.length < 32) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = (first: boolean) => {
      if (first) setLoading(true);
      api
        .get<TokenPreview>(`/api/token/preview?address=${encodeURIComponent(a)}&source=${source}`)
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setUpdatedAt(Date.now());
          setError(null);
        })
        .catch((e) => !cancelled && first && setError((e as Error).message))
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
          timer = setTimeout(() => load(false), PREVIEW_REFRESH_MS);
        });
    };
    timer = setTimeout(() => load(true), 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]);

  const token = preview?.token ?? null;
  const snapshot = preview?.snapshot ?? null;

  /** Powrót do wyboru tokena. */
  const exit = () => {
    setQuery('');
    setAddress('');
    setResults(null);
    setPhrase('');
    window.scrollTo(0, 0);
  };

  const start = async () => {
    await api.post('/api/session/start', {
      tokenAddress: address.trim(),
      mode,
      dataSource: source,
      startingCapitalUsd: mode === 'paper' ? capital : undefined,
      confirmPhrase: mode === 'live' ? phrase : undefined,
    });
  };

  return (
    <>
      {token ? null : (
        /* wybór tokena — znika, gdy token jest wybrany */
        <section className="search-hero">
          <div className="search-hero-head">
            <h1 className="search-hero-title">Znajdź token</h1>
            <div className="search-hero-sub">Wpisz nazwę lub symbol — albo wklej adres kontraktu (CA) czy link z pump.fun, GMGN lub DexScreener.</div>
          </div>

          <div className={`search-box ${searching || loading ? 'busy' : ''}`}>
            <svg className="search-box-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              autoFocus
              placeholder="np. pepe, $WIF, CA tokena albo link z pump.fun"
              value={query}
              onChange={(e) => {
                setError(null);
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results?.[0]) setAddress(results[0].address);
                if (e.key === 'Escape') setQuery('');
              }}
            />
            {query && (
              <button className="search-box-clear" onClick={() => setQuery('')} aria-label="Wyczyść" title="Wyczyść">
                ✕
              </button>
            )}
          </div>

          {error && <div className="err-box">{error}</div>}
          {loading && <div className="search-status">Pobieram dane tokena…</div>}

          {!address && results && (
            <div className="search-results">
              {searching && !results.length ? null : results.length ? (
                results.map((r) => (
                  <button key={`${r.chain}:${r.address}`} className="search-result" onClick={() => setAddress(r.address)}>
                    <TokenAvatar url={r.imageUrl} symbol={r.symbol} />
                    <span className="search-result-main">
                      <span className="search-result-name">
                        <b>{r.name}</b> <span className="muted">${r.symbol}</span>
                      </span>
                      <span className="search-result-tags">
                        <span className="badge b-cyan">{chainName(r.chain)}</span>
                        {isPumpFun(r) && <span className="badge b-green">pump.fun</span>}
                        <span className="mono faint small">{shortAddr(r.address, 5)}</span>
                        {r.createdAt && <span className="faint small">· {fmtAge(r.createdAt)}</span>}
                      </span>
                    </span>
                    <span className="search-result-stats">
                      <span>
                        <span className="faint">MC</span> <b>{fmtCompact(r.marketCapUsd)}</b>
                      </span>
                      <span>
                        <span className="faint">Płynność</span> <b>{fmtCompact(r.liquidityUsd)}</b>
                      </span>
                      <span>
                        <span className="faint">Wol. 24 h</span> <b>{fmtCompact(r.volume24hUsd)}</b>
                      </span>
                    </span>
                    <span className="search-result-go">›</span>
                  </button>
                ))
              ) : (
                <div className="search-status">Nic nie znaleziono dla „{query.trim()}”. Spróbuj innej nazwy albo wklej CA.</div>
              )}
            </div>
          )}
          {searching && !results?.length && <div className="search-status">Szukam…</div>}
        </section>
      )}

      {token && preview && (
        <>
          <div className="grid ov-main">
            <Panel flush>
              <TokenHeader token={token} snapshot={snapshot} actions={updatedAt && <span className="faint">odświeżane co 15 s · {fmtTime(updatedAt)}</span>} />
              <TimeframeChart address={token.address} baseCandles={preview.candles} baseTf={preview.timeframeSec} height={460} empty="Brak świec dla tego tokena w tym interwale" />
            </Panel>
          </div>

          <Playzone
            launch={{
              tokenSymbol: token.symbol,
              isSolana: token.chain === 'solana',
              chainLabel: chainName(token.chain),
              nativeSymbol: token.nativeSymbol,
              mode,
              setMode,
              capital,
              setCapital,
              phrase,
              setPhrase,
              liveEnabled: meta.liveTradingEnabled,
              confirmPhrase: meta.liveConfirmPhrase,
              onStart: start,
            }}
          />

          <div className="setup-exit">
            <button className="btn btn-lg" onClick={exit}>
              ← Wyjdź
            </button>
            <span className="small muted">Wraca do wyboru tokena. Zapisane ustawienia bota zostają.</span>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Aktywna sesja: wykres na żywo (reszta widoku w przebudowie)
// ---------------------------------------------------------------------------

/** Tymczasowe zakończenie sesji (na czas przebudowy widoku sesji): sprzedaje otwarte pozycje i kończy sesję. */
function StopSessionButton() {
  const session = useStore((s) => s.session)!;
  const positions = useStore((s) => s.positions.length);
  const [confirm, setConfirm] = useState(false);
  const stopping = session.status === 'stopping';
  return (
    <>
      <button className="btn btn-red btn-sm" disabled={stopping} onClick={() => setConfirm(true)}>
        {stopping ? 'Kończę sesję…' : '■ Zakończ sesję'}
      </button>
      {confirm && (
        <ConfirmModal
          title="Zakończyć sesję?"
          danger
          confirmLabel="Zakończ sesję"
          onConfirm={async () => {
            await api.post('/api/session/stop', { liquidate: true });
            toast('Sesja kończy się', 'ok');
          }}
          onClose={() => setConfirm(false)}
        >
          {positions > 0
            ? `Bot przestanie handlować, a ${positions === 1 ? 'otwarta pozycja zostanie sprzedana' : `${positions} otwarte pozycje zostaną sprzedane`} po bieżącej cenie.`
            : 'Bot przestanie handlować. Nie ma otwartych pozycji do sprzedania.'}
          {session.mode === 'paper' ? ' Tryb paper — bez prawdziwych środków.' : ' Tryb LIVE — sprzedaż odbędzie się prawdziwymi transakcjami.'}
        </ConfirmModal>
      )}
    </>
  );
}

function Live() {
  const token = useStore((s) => s.token);
  const snapshot = useStore((s) => s.market.snapshot);
  const session = useStore((s) => s.session)!;
  return (
    <>
      <Dashboard
        chartHead={token && <TokenHeader token={token} snapshot={snapshot} actions={
              <>
                <span className="faint">sesja #{session.id}</span>
                <StopSessionButton />
              </>
            } />}
      />
      <Playzone />
    </>
  );
}

/** Zakładka „Sesja”: bez sesji — wyszukanie tokena i podgląd; z sesją — panel na żywo i sterowanie botem. */
export function Session() {
  const session = useStore((s) => s.session);
  return session ? <Live /> : <Setup />;
}
