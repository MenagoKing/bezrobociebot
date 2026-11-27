import { useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api.ts';
import { ConfirmModal, ModeBadge, SessionStatusBadge, StateBadge, Toasts } from './components/ui.tsx';
import { fmtPct, fmtPrice, fmtUsd, pnlClass } from './format.ts';
import { Account } from './pages/Account.tsx';
import { Callouts } from './pages/Callouts.tsx';
import { Login } from './pages/Login.tsx';
import { MarketDynamics } from './pages/MarketDynamics.tsx';
import { Overview } from './pages/Overview.tsx';
import { Positions } from './pages/Positions.tsx';
import { SessionControl } from './pages/SessionControl.tsx';
import { Statistics } from './pages/Statistics.tsx';
import { System } from './pages/System.tsx';
import { TradingConfig } from './pages/TradingConfig.tsx';
import { connectStream, disconnectStream, loadState, useStore } from './store.ts';
import { chainName } from './chains.ts';

type Page = 'overview' | 'session' | 'trading' | 'market' | 'callouts' | 'positions' | 'stats' | 'account' | 'system';

const NAV: [Page, string, string][] = [
  ['overview', '◉', 'Overview'],
  ['session', '▶', 'Session Control'],
  ['trading', '⚙', 'Trading Config'],
  ['market', '∿', 'Market Dynamics'],
  ['callouts', '✎', 'Callout Manager'],
  ['positions', '≡', 'Pozycje i transakcje'],
  ['stats', '▤', 'Statystyki'],
  ['account', '◈', 'Konto i portfel'],
  ['system', '⚑', 'System'],
];

function usePage(): [Page, (p: Page) => void] {
  const read = () => (window.location.hash.slice(1) as Page) || 'overview';
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [page, (p) => (window.location.hash = p)];
}

function TopBar({ onLogout }: { onLogout: () => void }) {
  const session = useStore((s) => s.session);
  const token = useStore((s) => s.token);
  const snapshot = useStore((s) => s.market.snapshot);
  const bot = useStore((s) => s.bot);
  const connected = useStore((s) => s.connected);
  const stats = useStore((s) => s.stats);
  const solUsd = useStore((s) => s.market.snapshot?.solUsd ?? s.wallet.solUsd);
  const nativeSymbol = useStore((s) => (s.market.snapshot ? (s.session?.nativeSymbol ?? 'SOL') : 'SOL'));
  const [confirmStop, setConfirmStop] = useState(false);
  return (
    <header className="topbar">
      {token && session ? (
        <>
          <div className="token-chip">
            {token.imageUrl && <img src={token.imageUrl} alt="" />}
            <div>
              <div className="sym">{token.symbol}</div>
              <div className="small muted">{token.name}</div>
            </div>
          </div>
          <div className="token-price">${fmtPrice(snapshot?.priceUsd ?? token.priceUsd)}</div>
          {snapshot && <span className={`mono small ${pnlClass(snapshot.priceChange5mPct)}`}>5m {fmtPct(snapshot.priceChange5mPct)}</span>}
          <span className="badge b-cyan">{chainName(session.chain)}</span>
          <ModeBadge mode={session.mode} />
          <SessionStatusBadge status={session.status} />
          {stats && (
            <span className={`mono ${pnlClass(stats.totalPnl.usd)}`}>
              PnL {fmtUsd(stats.totalPnl.usd, true)} ({fmtPct(stats.pnlPct)})
            </span>
          )}
        </>
      ) : (
        <span className="muted">Brak aktywnej sesji</span>
      )}
      <span className="grow" />
      <StateBadge state={bot.state} />
      {solUsd > 0 && <span className="mono small muted">{nativeSymbol} ${solUsd.toFixed(2)}</span>}
      <span className={`badge ${connected ? 'b-green' : 'b-red'}`} title={connected ? 'Połączono (czas rzeczywisty)' : 'Brak połączenia — ponawianie'}>
        <span className={`dot ${connected ? '' : 'pulse'}`} />
        {connected ? 'LIVE' : 'OFFLINE'}
      </span>
      {session && (
        <button className="btn estop btn-sm" onClick={() => setConfirmStop(true)}>
          ■ EMERGENCY STOP
        </button>
      )}
      <button className="btn btn-ghost btn-sm" onClick={onLogout}>
        Wyloguj
      </button>
      {confirmStop && (
        <ConfirmModal
          title="Awaryjne zatrzymanie"
          danger
          confirmLabel="Zatrzymaj natychmiast"
          onConfirm={() => api.post('/api/session/emergency-stop')}
          onClose={() => setConfirmStop(false)}
        >
          <p>Natychmiast blokuje nowe zakupy i anuluje kolejkę zleceń. Jeśli w ustawieniach ryzyka włączona jest likwidacja awaryjna, otwarte pozycje zostaną sprzedane z pominięciem minimalnego czasu trzymania.</p>
        </ConfirmModal>
      )}
    </header>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = usePage();
  const errors = useStore((s) => s.health?.unacknowledgedErrors ?? 0);
  const pending = useStore((s) => s.callouts.filter((c) => c.status === 'pending').length);
  const loaded = useStore((s) => s.loaded);
  const updateAvailable = useStore((s) => s.updateAvailable);
  const version = useStore((s) => s.meta.version);
  const pages: Record<Page, ReactNode> = {
    overview: <Overview />,
    session: <SessionControl />,
    trading: <TradingConfig />,
    market: <MarketDynamics />,
    callouts: <Callouts />,
    positions: <Positions />,
    stats: <Statistics />,
    account: <Account />,
    system: <System />,
  };
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-logo">◎</div>SolDesk
        </div>
        {NAV.map(([key, ico, label]) => (
          <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => setPage(key)}>
            <span className="ico">{ico}</span>
            <span className="label">{label}</span>
            {key === 'system' && errors > 0 && <span className="nav-badge">{errors}</span>}
            {key === 'callouts' && pending > 0 && <span className="nav-badge" style={{ background: 'var(--amber)', color: '#111' }}>{pending}</span>}
          </button>
        ))}
        <div className="sidebar-foot">v{version} · dane w czasie rzeczywistym</div>
      </nav>
      <div className="main">
        <TopBar onLogout={onLogout} />
        {updateAvailable && (
          <div className="info-box spread" style={{ margin: '12px 18px 0' }}>
            <span>Dostępna nowa wersja panelu — odśwież stronę, aby z niej korzystać.</span>
            <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
              Odśwież
            </button>
          </div>
        )}
        <main className="content">{loaded ? pages[page] : <div className="empty">Ładowanie…</div>}</main>
      </div>
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<{ authenticated: boolean; setupRequired: boolean; setupAllowed: boolean } | null>(null);

  const refresh = () =>
    api
      .get<{ authenticated: boolean; setupRequired: boolean; setupAllowed: boolean }>('/api/auth/status')
      .then(setAuth)
      .catch(() => setAuth({ authenticated: false, setupRequired: false, setupAllowed: false }));

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth((a) => (a ? { ...a, authenticated: false } : a)));
    void refresh();
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    void loadState().catch(() => undefined);
    connectStream();
    return () => disconnectStream();
  }, [auth?.authenticated]);

  if (!auth) return <div className="login muted">Łączenie z serwerem…</div>;
  if (!auth.authenticated) return <Login status={auth} onDone={refresh} />;
  return (
    <>
      <Shell
        onLogout={async () => {
          await api.post('/api/auth/logout').catch(() => undefined);
          void refresh();
        }}
      />
      <Toasts />
    </>
  );
}
