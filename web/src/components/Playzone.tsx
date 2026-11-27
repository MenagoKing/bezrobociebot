import { useState, type ReactNode } from 'react';
import { SCENARIO_LABELS, type ExecutionMode, type Scenario, type TacticId, type TacticSet, type TradingConfig } from '../../../shared/types.ts';
import { DEFAULT_TACTICS } from '../../../shared/tactics.ts';
import { api } from '../api.ts';
import { toast, useStore } from '../store.ts';
import { ActionButton, Panel } from './ui.tsx';

/**
 * Taktyka = zestaw reguł wejścia i wyjścia (zapisany w ustawieniach „tactics”, edytowalny w zakładce Strategia).
 * Kwoty transakcji i limity ryzyka zostają takie, jak w Ustawieniach — taktyka zmienia tylko to, KIEDY bot kupuje i sprzedaje.
 */
export interface TacticMeta {
  id: TacticId;
  name: string;
  desc: string;
  icon: ReactNode;
}
export interface Tactic extends TacticMeta {
  set: TacticSet;
}

const ico = (d: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const TACTIC_META: TacticMeta[] = [
  {
    id: 'volume',
    name: 'Volumen',
    desc: 'Kupuje, gdy na rynku rośnie wolumen i przeważają kupujący — wchodzi tam, gdzie ruch jest prawdziwy. Krótkie pozycje, szybkie wyjście.',
    icon: ico(<path d="M4 20V14M9 20V9M14 20V12M19 20V4" />),
  },
  {
    id: 'maxprofit',
    name: 'Max profit',
    desc: 'Wchodzi tylko w mocny wzrost i pozwala zyskom rosnąć: zamiast sztywnego celu sprzedaje, gdy cena cofnie się od szczytu (trailing stop).',
    icon: ico(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />),
  },
];

/** Taktyki z bieżącymi ustawieniami z serwera. */
export function useTactics(): Tactic[] {
  // zapas: serwer sprzed aktualizacji nie wysyła jeszcze taktyk
  const sets = useStore((s) => s.settings.tactics) ?? DEFAULT_TACTICS;
  return TACTIC_META.map((m) => ({ ...m, set: sets[m.id] }));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Czy ustawienia bota są dokładnie ustawieniami danej taktyki. */
export function matchesTactic(t: TradingConfig, set: TacticSet): boolean {
  return (Object.keys(set) as (keyof TacticSet)[]).every((k) => {
    const a = t[k];
    const b = set[k];
    return Array.isArray(a) && Array.isArray(b) ? sameList(a, b) : a === b;
  });
}

/** Która taktyka odpowiada bieżącym ustawieniom (null = ustawienia własne). */
export function activeTactic(t: TradingConfig, tactics: Tactic[]): TacticId | null {
  return tactics.find((tac) => matchesTactic(t, tac.set))?.id ?? null;
}

const scen = (list: readonly Scenario[]) => list.map((s) => SCENARIO_LABELS[s]).join(', ');

/** Ustawienia startu sesji — gdy Playzone jest na ekranie przed uruchomieniem bota. */
export interface PlayzoneLaunch {
  tokenSymbol: string;
  isSolana: boolean;
  chainLabel: string;
  nativeSymbol: string;
  mode: ExecutionMode;
  setMode: (m: ExecutionMode) => void;
  capital: number;
  setCapital: (v: number) => void;
  phrase: string;
  setPhrase: (v: string) => void;
  liveEnabled: boolean;
  confirmPhrase: string;
  /** uruchamia sesję (ustawienia taktyki są już zapisane) */
  onStart: () => Promise<unknown>;
}

/**
 * Playzone: wybór taktyki bota + Start / Zatrzymaj.
 * Bez sesji (launch) Start zapisuje taktykę i uruchamia sesję; w sesji wznawia albo zmienia taktykę.
 */
export function Playzone({ launch }: { launch?: PlayzoneLaunch }) {
  const session = useStore((s) => s.session);
  const trading = useStore((s) => s.settings.trading);
  const tactics = useTactics();
  const active = activeTactic(trading, tactics);
  const [picked, setPicked] = useState<TacticId | null>(active ?? 'volume');
  const tactic = tactics.find((t) => t.id === picked) ?? null;
  const inSession = !!session && !launch;
  const running = inSession && session.status === 'running';
  const stopping = inSession && session.status === 'stopping';
  const changed = !!tactic && tactic.id !== active;
  const launchReady = !launch || launch.mode !== 'live' || launch.phrase === launch.confirmPhrase;

  const start = async () => {
    if (tactic && changed) await api.put('/api/settings/trading', { ...trading, ...tactic.set });
    if (launch) {
      await launch.onStart();
      toast(`Sesja rozpoczęta — taktyka: ${tactic?.name ?? 'własne ustawienia'}`, 'ok');
      return;
    }
    if (!running) await api.post('/api/session/resume');
    toast(running ? `Taktyka: ${tactic?.name}` : `Bot handluje — taktyka: ${tactic?.name ?? 'własne ustawienia'}`, 'ok');
  };
  const stop = async () => {
    await api.post('/api/session/pause');
    toast('Bot zatrzymany — nie otwiera nowych pozycji', 'ok');
  };

  return (
    <Panel
      title="Playzone"
      actions={
        <span className={`pz-state ${running ? 'on' : ''}`}>
          <span className="pz-dot" />
          {launch ? 'Gotowy do startu' : stopping ? 'Kończenie sesji…' : running ? 'Bot handluje' : 'Bot zatrzymany'}
        </span>
      }
    >
      <div className="pz-label">Wybierz taktykę</div>
      <div className="pz-grid" role="radiogroup" aria-label="Taktyka bota">
        {tactics.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={picked === t.id}
            disabled={stopping}
            className={`pz-card${picked === t.id ? ' on' : ''}`}
            onClick={() => setPicked(t.id)}
          >
            <span className="pz-card-top">
              <span className="pz-ico">{t.icon}</span>
              <b>{t.name}</b>
              {active === t.id && <span className="pz-badge">{launch ? 'zapisana' : 'aktywna'}</span>}
            </span>
            <span className="pz-desc">{t.desc}</span>
            <span className="pz-meta">
              {t.set.takeProfitPct > 0 ? `TP ${t.set.takeProfitPct}%` : `trailing ${t.set.trailingStopPct}%`} · SL {t.set.stopLossPct}% · trzyma {Math.round(t.set.minHoldSeconds / 60) || '<1'}–{Math.round(t.set.maxHoldSeconds / 60)} min
            </span>
          </button>
        ))}
      </div>
      {tactic && (
        <div className="pz-hint small muted">
          Kupuje przy: {scen(tactic.set.entryScenarios)}
          {tactic.set.minVolumeRatio > 0 && `, gdy wolumen urośnie co najmniej ×${tactic.set.minVolumeRatio}`}
          {tactic.set.minBuySellRatio > 0 && ` i kupujących będzie ×${tactic.set.minBuySellRatio} więcej niż sprzedających`}. Sprzedaje też przy: {scen(tactic.set.exitOnScenarios)}.
        </div>
      )}
      {!active && !tactic && <div className="pz-hint small faint">Obecnie bot używa własnych ustawień z zakładki Ustawienia → Strategia.</div>}

      {launch && (
        <div className="pz-launch">
          <div className="col" style={{ gap: 6 }}>
            <span className="pz-label" style={{ margin: 0 }}>
              Tryb
            </span>
            <div className="seg">
              <button className={launch.mode === 'paper' ? 'on' : ''} onClick={() => launch.setMode('paper')}>
                Paper (symulacja)
              </button>
              <button
                className={launch.mode === 'live' ? 'on' : ''}
                disabled={!launch.liveEnabled}
                title={!launch.liveEnabled ? 'Wyłączone na serwerze (LIVE_TRADING_ENABLED)' : ''}
                onClick={() => launch.setMode('live')}
              >
                Live (prawdziwe środki)
              </button>
            </div>
          </div>
          {launch.mode === 'paper' && (
            <label className="field" style={{ width: 190, margin: 0 }}>
              <span className="pz-label" style={{ margin: 0 }}>
                Kapitał symulacyjny
              </span>
              <div className="input-unit">
                <input type="number" className="mono" step="0.1" min="0.1" value={launch.capital} onChange={(e) => launch.setCapital(Number(e.target.value))} />
                <span>USD</span>
              </div>
            </label>
          )}
        </div>
      )}
      {launch?.mode === 'live' && (
        <div className="warn-box col" style={{ marginTop: 12 }}>
          <b>Tryb live używa prawdziwych środków z Twojego portfela.</b>
          <span className="small">
            Transakcje są nieodwracalne.{' '}
            {launch.isSolana
              ? 'Przy kapitale rzędu 1–2 USD opłaty (prowizja platformy, opłata sieci, rent ~0,002 SOL za konto tokena) mogą pochłonąć znaczną część kapitału. '
              : `Sieć ${launch.chainLabel}: swap przez LI.FI z portfela EVM (waluta ${launch.nativeSymbol}). `}
            Aby potwierdzić, wpisz: <code>{launch.confirmPhrase}</code>
          </span>
          <input className="mono" value={launch.phrase} onChange={(e) => launch.setPhrase(e.target.value)} placeholder={launch.confirmPhrase} />
        </div>
      )}

      <div className="pz-actions">
        <ActionButton className="btn-primary btn-lg pz-btn" disabled={stopping || !launchReady || (running && !changed)} onClick={start}>
          ▶ {launch ? `Start na ${launch.tokenSymbol}` : running && changed ? 'Zmień taktykę' : 'Start'}
        </ActionButton>
        <ActionButton className="btn-lg pz-btn" disabled={stopping || !running} onClick={stop} title={launch ? 'Dostępne po uruchomieniu bota' : undefined}>
          ❚❚ Zatrzymaj
        </ActionButton>
        <span className="small faint">
          Kwoty transakcji i limity ryzyka zostają takie jak w Ustawieniach.{' '}
          {launch ? 'Po starcie możesz w każdej chwili zatrzymać bota albo zmienić taktykę.' : 'Zatrzymanie wstrzymuje decyzje bota — otwartych pozycji nie sprzedaje (do tego służy „Sprzedaj wszystko” w Pozycjach).'}
        </span>
      </div>
    </Panel>
  );
}
