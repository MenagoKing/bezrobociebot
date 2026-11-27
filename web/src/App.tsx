import { useEffect, useState, type ReactNode } from 'react';
import { Toasts } from './components/ui.tsx';
import { Account } from './pages/Account.tsx';
import { Positions } from './pages/Positions.tsx';
import { Session } from './pages/Session.tsx';
import { Settings } from './pages/Settings.tsx';
import { Strategy } from './pages/Strategy.tsx';
import { connectStream, disconnectStream, loadState, useStore } from './store.ts';

type Page = 'session' | 'strategy' | 'account' | 'positions' | 'settings';

/** Ikony menu bocznego — jednolite SVG w kolorze tekstu. */
const navIcon = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const NAV: [Page, ReactNode, string][] = [
  ['session', navIcon(<path d="M7 4.5v15l12-7.5z" fill="currentColor" />), 'Start'],
  [
    'account',
    navIcon(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </>,
    ),
    'Konta',
  ],
  ['positions', navIcon(<path d="M4 6h16M4 12h16M4 18h16" />), 'Pozycje'],
  [
    'strategy',
    navIcon(
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </>,
    ),
    'Strategia',
  ],
  [
    'settings',
    navIcon(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>,
    ),
    'Ustawienia',
  ],
];

/** Dawne zakładki, które przeniosły się do Ustawień (stare linki nadal działają). */
const MOVED_TO_SETTINGS: Record<string, string> = { trading: 'strategy', market: 'market', stats: 'stats', system: 'monitoring' };
const PAGES = new Set<string>(NAV.map(([key]) => key));

function usePage(): [Page, (p: Page) => void] {
  // dawne zakładki Overview i Session Control to teraz jedna zakładka „Start”
  // Ustawienia mają podsekcje: #settings/strategy, #settings/risk…
  const read = (): Page => {
    const h = window.location.hash.slice(1).split('/')[0]!;
    if (MOVED_TO_SETTINGS[h]) {
      window.location.replace(`#settings/${MOVED_TO_SETTINGS[h]}`);
      return 'settings';
    }
    return PAGES.has(h) ? (h as Page) : 'session';
  };
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [page, (p) => (window.location.hash = p)];
}

function TopBar() {
  const session = useStore((s) => s.session);
  const connected = useStore((s) => s.connected);
  return (
    <header className="topbar">
      <span className="grow" />
      {/* LIVE = otwarta sesja, OFFLINE = brak sesji; utrata połączenia z serwerem ma pierwszeństwo */}
      {!connected ? (
        <span className="badge b-red" title="Brak połączenia z serwerem — ponawianie">
          <span className="dot pulse" />
          BRAK POŁĄCZENIA
        </span>
      ) : session ? (
        <span className="badge b-green" title="Sesja jest otwarta">
          <span className="dot pulse" />
          LIVE
        </span>
      ) : (
        <span className="badge b-gray" title="Brak otwartej sesji">
          <span className="dot" />
          OFFLINE
        </span>
      )}
    </header>
  );
}

function Shell() {
  const [page, setPage] = usePage();
  const errors = useStore((s) => s.health?.unacknowledgedErrors ?? 0);
  const loaded = useStore((s) => s.loaded);
  const updateAvailable = useStore((s) => s.updateAvailable);
  const version = useStore((s) => s.meta.version);
  const pages: Record<Page, ReactNode> = {
    session: <Session />,
    strategy: <Strategy />,
    account: <Account />,
    positions: <Positions />,
    settings: <Settings />,
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
            {key === 'settings' && errors > 0 && <span className="nav-badge" title="Nowe błędy — Ustawienia → Monitoring">{errors}</span>}
          </button>
        ))}
        <div className="sidebar-foot nav-bottom">v{version}</div>
      </nav>
      <div className="main">
        <TopBar />
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
  const [error, setError] = useState<string | null>(null);

  // bez logowania: panel od razu pobiera stan i łączy się z serwerem na żywo
  useEffect(() => {
    void loadState().catch((e) => setError((e as Error).message));
    connectStream();
    return () => disconnectStream();
  }, []);

  if (error) {
    return (
      <div className="login">
        <div className="login-card">
          <b>Nie można połączyć się z panelem</b>
          <div className="muted small">{error}</div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Spróbuj ponownie
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <Shell />
      <Toasts />
    </>
  );
}
