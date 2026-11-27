import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store.ts';
import { MarketDynamics } from './MarketDynamics.tsx';
import { Statistics } from './Statistics.tsx';
import { SystemConnections, SystemMonitoring } from './System.tsx';
import { RiskSettings, StrategySettings } from './TradingConfig.tsx';

/** Ikony liniowe (24×24, kolor z currentColor) — spójne z resztą panelu, bez emotek. */
function SvgIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  strategy: (
    <SvgIcon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </SvgIcon>
  ),
  risk: (
    <SvgIcon>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />
      <path d="M9 12l2 2 4-4" />
    </SvgIcon>
  ),
  market: (
    <SvgIcon>
      <path d="M3 17l5.5-5.5 4 4L21 7" />
      <path d="M15 7h6v6" />
    </SvgIcon>
  ),
  stats: (
    <SvgIcon>
      <path d="M4 20h16" />
      <rect x="5.5" y="11" width="3" height="7" rx="0.6" />
      <rect x="10.5" y="6" width="3" height="12" rx="0.6" />
      <rect x="15.5" y="9" width="3" height="9" rx="0.6" />
    </SvgIcon>
  ),
  monitoring: (
    <SvgIcon>
      <path d="M3 12h4l2.5-6 5 12 2.5-6H21" />
    </SvgIcon>
  ),
  connections: (
    <SvgIcon>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="19" r="2.2" />
      <circle cx="19" cy="19" r="2.2" />
      <path d="M12 7.2v4.3M12 11.5l-5.6 5.6M12 11.5l5.6 5.6" />
    </SvgIcon>
  ),
};

export type SettingsSectionId = 'strategy' | 'risk' | 'market' | 'stats' | 'monitoring' | 'connections';

interface Section {
  id: SettingsSectionId;
  group: string;
  icon: ReactNode;
  title: string;
  /** krótko: co tu znajdziesz */
  desc: string;
  render: () => ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'strategy',
    group: 'Bot',
    icon: ICONS.strategy,
    title: 'Strategia',
    desc: 'Ile kupować i kiedy sprzedawać',
    render: () => <StrategySettings />,
  },
  {
    id: 'risk',
    group: 'Bot',
    icon: ICONS.risk,
    title: 'Ryzyko',
    desc: 'Limity strat i bezpieczeństwo',
    render: () => <RiskSettings />,
  },
  {
    id: 'market',
    group: 'Bot',
    icon: ICONS.market,
    title: 'Analiza rynku',
    desc: 'Jak bot ocenia rynek',
    render: () => <MarketDynamics />,
  },
  {
    id: 'stats',
    group: 'Wyniki',
    icon: ICONS.stats,
    title: 'Statystyki',
    desc: 'Wyniki i historia sesji',
    render: () => <Statistics />,
  },
  {
    id: 'monitoring',
    group: 'System',
    icon: ICONS.monitoring,
    title: 'Monitoring',
    desc: 'Błędy, stan serwera, kopie',
    render: () => <SystemMonitoring />,
  },
  {
    id: 'connections',
    group: 'System',
    icon: ICONS.connections,
    title: 'Sieci i połączenia',
    desc: 'Sieci, RPC i odświeżanie',
    render: () => <SystemConnections />,
  },
];

const IDS = new Set(SECTIONS.map((s) => s.id));

/** Sekcja z adresu: #settings/<sekcja>. */
function readSection(): SettingsSectionId {
  const sub = window.location.hash.slice(1).split('/')[1] as SettingsSectionId | undefined;
  return sub && IDS.has(sub) ? sub : 'strategy';
}

export function Settings() {
  const [active, setActive] = useState<SettingsSectionId>(readSection);
  const errors = useStore((s) => s.health?.unacknowledgedErrors ?? 0);

  useEffect(() => {
    const on = () => setActive(readSection());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const open = (id: SettingsSectionId) => {
    window.location.hash = `settings/${id}`;
    window.scrollTo(0, 0);
  };

  const section = SECTIONS.find((s) => s.id === active)!;

  return (
    <>
      <div>
        <h1 className="page-title">Ustawienia</h1>
        <div className="page-sub">Wybierz, co chcesz zmienić. Zmiany działają od razu — bez restartu.</div>
      </div>

      {/* wybór sekcji — duże kafle */}
      <nav className="settings-tiles" aria-label="Sekcje ustawień">
        {SECTIONS.map((s) => (
          <button key={s.id} className={`settings-tile ${s.id === active ? 'on' : ''}`} onClick={() => open(s.id)} aria-current={s.id === active ? 'page' : undefined}>
            <span className="settings-tile-ico">{s.icon}</span>
            <span className="settings-tile-text">
              <span className="settings-tile-title">
                {s.title}
                {s.id === 'monitoring' && errors > 0 && <span className="nav-badge">{errors}</span>}
              </span>
              <span className="settings-tile-desc">{s.desc}</span>
            </span>
          </button>
        ))}
      </nav>

      <section className="settings-content">
        <header className="settings-head">
          <span className="settings-head-ico">{section.icon}</span>
          <div>
            <h2 className="settings-title">{section.title}</h2>
            <div className="page-sub">{section.desc}</div>
          </div>
        </header>
        <div className="settings-body">{section.render()}</div>
      </section>
    </>
  );
}
