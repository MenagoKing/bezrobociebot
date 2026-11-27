import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SCENARIOS, SCENARIO_LABELS, type AppSettings, type Preset, type Scenario, type SettingsSection } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { toast, useStore } from '../store.ts';
import { ActionButton, Panel, Toggle } from './ui.tsx';

export type Field =
  | { key: string; label: string; type: 'number'; unit?: string; step?: number; min?: number; max?: number; help?: string }
  | { key: string; label: string; type: 'select'; options: [string, string][]; help?: string }
  | { key: string; label: string; type: 'toggle'; help?: string }
  | { key: string; label: string; type: 'text'; help?: string }
  | { key: string; label: string; type: 'scenarios'; help?: string };

export interface FieldGroup {
  title: string;
  fields: Field[];
}

type Draft = Record<string, unknown>;

export function ScenarioPicker({ value, onChange }: { value: Scenario[]; onChange: (v: Scenario[]) => void }) {
  return (
    <div className="chips">
      {SCENARIOS.map((s) => (
        <button
          type="button"
          key={s}
          className={`chip ${value.includes(s) ? 'on' : ''}`}
          onClick={() => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s])}
        >
          {SCENARIO_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

export function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'number':
      return (
        <div className={field.unit ? 'input-unit' : ''}>
          <input
            type="number"
            className="mono"
            step={field.step ?? 'any'}
            min={field.min}
            max={field.max}
            value={Number.isFinite(value as number) ? (value as number) : ''}
            onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
            style={{ width: '100%' }}
          />
          {field.unit && <span>{field.unit}</span>}
        </div>
      );
    case 'select':
      return (
        <select value={String(value)} onChange={(e) => onChange(typeof value === 'number' ? Number(e.target.value) : e.target.value)}>
          {field.options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      );
    case 'toggle':
      return <Toggle checked={!!value} onChange={onChange} />;
    case 'text':
      return <input className="mono" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'scenarios':
      return <ScenarioPicker value={(value as Scenario[]) ?? []} onChange={onChange} />;
  }
}

/** Formularz sekcji ustawień generowany z opisu pól; zapis walidowany po stronie serwera. */
export function SettingsForm<K extends SettingsSection>(props: {
  section: K;
  title: string;
  groups: FieldGroup[];
  aside?: (draft: AppSettings[K]) => ReactNode;
  actions?: ReactNode;
}) {
  const stored = useStore((s) => s.settings?.[props.section]);
  const [draft, setDraft] = useState<Draft>(() => ({ ...(stored as unknown as Draft) }));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty && stored) setDraft({ ...(stored as unknown as Draft) });
  }, [stored, dirty]);

  const set = (key: string, v: unknown) => {
    setDraft((d) => ({ ...d, [key]: v }));
    setDirty(true);
  };

  const save = async () => {
    setError(null);
    try {
      await api.put(`/api/settings/${props.section}`, draft);
      setDirty(false);
      toast('Zapisano ustawienia', 'ok');
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  if (!stored) return null;
  return (
    <Panel
      title={props.title}
      actions={
        <>
          {props.actions}
          {dirty && (
            <button className="btn btn-ghost btn-sm" onClick={() => (setDraft({ ...(stored as unknown as Draft) }), setDirty(false), setError(null))}>
              Odrzuć zmiany
            </button>
          )}
          <ActionButton className="btn-sm" onClick={() => api.post(`/api/settings/${props.section}/reset`).then(() => setDirty(false))} success="Przywrócono domyślne">
            Domyślne
          </ActionButton>
          <ActionButton className="btn-primary btn-sm" disabled={!dirty} onClick={save}>
            Zapisz
          </ActionButton>
        </>
      }
    >
      {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}
      <div className={props.aside ? 'grid g-main' : ''}>
        <div>
          {props.groups.map((g) => (
            <div className="form-section" key={g.title}>
              <h4>{g.title}</h4>
              <div className="form-grid">
                {g.fields.map((f) => (
                  <label className="field" key={f.key} style={f.type === 'scenarios' ? { gridColumn: '1 / -1' } : undefined}>
                    <span className="field-label">{f.label}</span>
                    <FieldInput field={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} />
                    {f.help && <span className="field-help">{f.help}</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {props.aside && <div>{props.aside(draft as unknown as AppSettings[K])}</div>}
      </div>
    </Panel>
  );
}

/** Zapisywanie i wczytywanie presetów konfiguracji. */
export function PresetBar({ kind }: { kind: Preset['kind'] }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<number | ''>('');
  const [name, setName] = useState('');
  const load = useCallback(() => api.get<Preset[]>(`/api/presets?kind=${kind}`).then(setPresets), [kind]);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  return (
    <Panel title={`Presety (${kind === 'trading' ? 'handel + ryzyko' : 'analiza'})`}>
      <div className="row">
        <select value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')} style={{ minWidth: 200 }}>
          <option value="">— wybierz preset —</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <ActionButton className="btn-sm" disabled={selected === ''} onClick={() => api.post(`/api/presets/${selected}/apply`)} success="Preset wczytany">
          Wczytaj
        </ActionButton>
        <ActionButton
          className="btn-sm btn-ghost"
          disabled={selected === ''}
          onClick={async () => {
            await api.del(`/api/presets/${selected}`);
            setSelected('');
            await load();
          }}
          success="Preset usunięty"
        >
          Usuń
        </ActionButton>
        <span className="grow" />
        <input placeholder="nazwa nowego presetu" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
        <ActionButton
          className="btn-sm btn-primary"
          disabled={!name.trim()}
          onClick={async () => {
            await api.post('/api/presets', { kind, name: name.trim() });
            setName('');
            await load();
          }}
          success="Zapisano bieżącą konfigurację jako preset"
        >
          Zapisz bieżącą
        </ActionButton>
      </div>
    </Panel>
  );
}
