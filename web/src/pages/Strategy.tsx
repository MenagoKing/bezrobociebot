import { useEffect, useState } from 'react';
import type { TacticSet } from '../../../shared/types.ts';
import { DEFAULT_TACTICS } from '../../../shared/tactics.ts';
import { api } from '../api.ts';
import { FieldInput, type FieldGroup } from '../components/settings.tsx';
import { matchesTactic, useTactics, type Tactic } from '../components/Playzone.tsx';
import { ActionButton, PageHeader, Panel } from '../components/ui.tsx';
import { toast, useStore } from '../store.ts';

const GROUPS: FieldGroup[] = [
  {
    title: 'Kiedy kupować',
    fields: [
      { key: 'entryScenarios', label: 'Kupuj przy scenariuszach rynku', type: 'scenarios', help: 'Pusta lista = taktyka nie kupuje' },
      { key: 'minConfidence', label: 'Min. pewność analizy', type: 'number', step: 0.05, min: 0, max: 1, help: '0–1, np. 0.5 = 50%' },
      { key: 'minVolumeRatio', label: 'Min. wzrost wolumenu', type: 'number', unit: '×', step: 0.1, min: 0, help: '0 = wyłączone; 1.5 = wolumen o 50% wyższy niż wcześniej' },
      { key: 'minBuySellRatio', label: 'Min. przewaga kupujących (5 min)', type: 'number', unit: '×', step: 0.1, min: 0, help: '0 = wyłączone; 1.3 = o 30% więcej kupna niż sprzedaży' },
      { key: 'buyCooldownSeconds', label: 'Odstęp między zakupami', type: 'number', unit: 's', step: 5, min: 0 },
    ],
  },
  {
    title: 'Kiedy sprzedawać',
    fields: [
      { key: 'takeProfitPct', label: 'Take profit', type: 'number', unit: '%', step: 0.5, min: 0, help: '0 = bez sztywnego celu (decyduje trailing stop)' },
      { key: 'stopLossPct', label: 'Stop loss', type: 'number', unit: '%', step: 0.5, min: 0, help: '0 = wyłączony' },
      { key: 'trailingStopPct', label: 'Trailing stop', type: 'number', unit: '%', step: 0.5, min: 0, help: 'Spadek od szczytu, gdy pozycja była na plusie; 0 = wyłączony' },
      { key: 'minHoldSeconds', label: 'Min. czas trzymania', type: 'number', unit: 's', step: 5, min: 0 },
      { key: 'maxHoldSeconds', label: 'Maks. czas trzymania', type: 'number', unit: 's', step: 30, min: 0, help: '0 = bez limitu' },
      { key: 'exitOnScenarios', label: 'Sprzedaj też przy scenariuszach', type: 'scenarios' },
    ],
  },
];

/** Edycja jednej taktyki Playzone. Gdy taktyka jest aktywna, zapis od razu zmienia zachowanie bota. */
function TacticEditor({ tactic }: { tactic: Tactic }) {
  const trading = useStore((s) => s.settings.trading);
  const allSets = useStore((s) => s.settings.tactics) ?? DEFAULT_TACTICS;
  const isActive = matchesTactic(trading, tactic.set);
  const [draft, setDraft] = useState<TacticSet>(tactic.set);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(tactic.set);
  }, [tactic.set, dirty]);

  const set = (key: string, v: unknown) => {
    setDraft((d) => ({ ...d, [key]: v }));
    setDirty(true);
  };

  const save = async () => {
    setError(null);
    try {
      await api.put('/api/settings/tactics', { ...allSets, [tactic.id]: draft });
      // aktywna taktyka: bot od razu przechodzi na nowe reguły
      if (isActive) await api.put('/api/settings/trading', { ...trading, ...draft });
      setDirty(false);
      toast(isActive ? `Zapisano „${tactic.name}” — bot używa już nowych reguł` : `Zapisano „${tactic.name}”`, 'ok');
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const activate = async () => {
    await api.put('/api/settings/trading', { ...trading, ...tactic.set });
    toast(`Aktywna taktyka: ${tactic.name}`, 'ok');
  };

  return (
    <Panel
      title={
        <span className="st-title">
          <span className="pz-ico">{tactic.icon}</span>
          {tactic.name}
          {isActive && <span className="pz-badge">aktywna</span>}
        </span>
      }
      actions={
        <>
          {!isActive && (
            <ActionButton className="btn-sm" disabled={dirty} onClick={activate} title={dirty ? 'Najpierw zapisz zmiany' : 'Bot zacznie używać tej taktyki'}>
              Ustaw jako aktywną
            </ActionButton>
          )}
          {dirty && (
            <button className="btn btn-ghost btn-sm" onClick={() => (setDraft(tactic.set), setDirty(false), setError(null))}>
              Odrzuć zmiany
            </button>
          )}
          <ActionButton className="btn-primary btn-sm" disabled={!dirty} onClick={save}>
            Zapisz
          </ActionButton>
        </>
      }
    >
      <div className="st-desc muted">{tactic.desc}</div>
      {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}
      {GROUPS.map((g) => (
        <div className="form-section" key={g.title}>
          <h4>{g.title}</h4>
          <div className="form-grid">
            {g.fields.map((f) => (
              <label className="field" key={f.key} style={f.type === 'scenarios' ? { gridColumn: '1 / -1' } : undefined}>
                <span className="field-label">{f.label}</span>
                <FieldInput field={f} value={(draft as unknown as Record<string, unknown>)[f.key]} onChange={(v) => set(f.key, v)} />
                {'help' in f && f.help && <span className="field-help">{f.help}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  );
}

/** Zakładka „Strategia”: ustawienia taktyk, które wybierasz w Playzone. */
export function Strategy() {
  const tactics = useTactics();
  return (
    <div className="big-ui">
      <PageHeader
        icon={
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1" fill="currentColor" />
          </svg>
        }
        title="Strategia"
        desc="Ustawienia taktyk z Playzone: kiedy bot kupuje i kiedy sprzedaje. Kwoty transakcji i limity ryzyka są w Ustawieniach."
      />
      {tactics.map((t) => (
        <TacticEditor key={t.id} tactic={t} />
      ))}
      <div className="setup-exit">
        <ActionButton className="btn-lg" onClick={() => api.post('/api/settings/tactics/reset')} success="Przywrócono domyślne taktyki">
          Przywróć domyślne taktyki
        </ActionButton>
        <span className="small muted">Przywraca wartości obu taktyk. Nie zmienia aktualnie używanych ustawień bota.</span>
      </div>
    </div>
  );
}
