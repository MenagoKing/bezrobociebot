import { useCallback, useEffect, useMemo, useState } from 'react';
import { CALLOUT_EVENTS, CALLOUT_EVENT_LABELS, type CalloutConfig, type CalloutEvent, type CalloutTemplate } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ActionButton, Badge, DataTable, Empty, Modal, Panel, Tabs, Toggle } from '../components/ui.tsx';
import { CalloutFeed } from '../components/widgets.tsx';
import { fmtDateTime } from '../format.ts';
import { toast, useStore } from '../store.ts';

type Tab = 'queue' | 'feed' | 'templates' | 'import' | 'settings';
type TemplateDraft = Omit<CalloutTemplate, 'id' | 'createdAt'> & { id?: number };

function useVariables(): Record<string, string> {
  const [vars, setVars] = useState<Record<string, string>>({});
  useEffect(() => {
    void api.get<Record<string, string>>('/api/callouts/variables').then(setVars).catch(() => undefined);
  }, []);
  return vars;
}

function TemplateEditor({ draft, onClose, onSaved }: { draft: TemplateDraft; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState(draft);
  const [preview, setPreview] = useState<{ text: string; unknown: string[] } | null>(null);
  const vars = useVariables();

  useEffect(() => {
    if (!t.body.trim()) return setPreview(null);
    const h = setTimeout(() => {
      void api.post<{ text: string; unknown: string[] }>('/api/callouts/preview', { body: t.body, event: t.event }).then(setPreview).catch(() => undefined);
    }, 250);
    return () => clearTimeout(h);
  }, [t.body, t.event]);

  const save = async () => {
    const body = { name: t.name, category: t.category, event: t.event, body: t.body, enabled: t.enabled, weight: t.weight };
    if (t.id) await api.put(`/api/callouts/templates/${t.id}`, body);
    else await api.post('/api/callouts/templates', body);
    onSaved();
    onClose();
  };

  return (
    <Modal
      title={t.id ? 'Edycja szablonu' : 'Nowy szablon'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Anuluj</button>
          <ActionButton className="btn-primary" onClick={save} success="Szablon zapisany">Zapisz</ActionButton>
        </>
      }
    >
      <div className="form-grid">
        <label className="field"><span className="field-label">Nazwa</span><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
        <label className="field"><span className="field-label">Kategoria</span><input value={t.category} onChange={(e) => setT({ ...t, category: e.target.value })} /></label>
        <label className="field">
          <span className="field-label">Zdarzenie wyzwalające</span>
          <select value={t.event} onChange={(e) => setT({ ...t, event: e.target.value as CalloutEvent })}>
            {CALLOUT_EVENTS.map((e) => <option key={e} value={e}>{CALLOUT_EVENT_LABELS[e]}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Waga losowania</span><input type="number" min={1} max={100} value={t.weight} onChange={(e) => setT({ ...t, weight: Number(e.target.value) })} /></label>
      </div>
      <label className="field">
        <span className="field-label">Treść (zmienne w nawiasach klamrowych)</span>
        <textarea className="mono" rows={4} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} />
      </label>
      <div className="chips">
        {Object.entries(vars).map(([k, label]) => (
          <button key={k} type="button" className="chip" title={label} onClick={() => setT({ ...t, body: `${t.body}{${k}}` })}>
            {`{${k}}`}
          </button>
        ))}
      </div>
      <Toggle checked={t.enabled} onChange={(v) => setT({ ...t, enabled: v })} label="Szablon aktywny" />
      {preview && (
        <div className="panel" style={{ background: 'var(--bg-2)' }}>
          <div className="panel-body col">
            <span className="field-label">Podgląd (przykładowe dane)</span>
            <div>{preview.text}</div>
            {preview.unknown.length > 0 && <div className="warn-text small">Nieznane zmienne: {preview.unknown.map((u) => `{${u}}`).join(', ')}</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Templates() {
  const [list, setList] = useState<CalloutTemplate[]>([]);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [edit, setEdit] = useState<TemplateDraft | null>(null);
  const load = useCallback(() => api.get<CalloutTemplate[]>('/api/callouts/templates').then(setList), []);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  const categories = useMemo(() => [...new Set(list.map((t) => t.category))].sort(), [list]);
  const rows = list.filter((t) => (!category || t.category === category) && (!filter || `${t.name} ${t.body}`.toLowerCase().includes(filter.toLowerCase())));

  return (
    <Panel
      title={`Szablony (${list.length})`}
      flush
      actions={
        <>
          <input placeholder="Szukaj…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Wszystkie kategorie</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => setEdit({ name: '', category: 'ogólne', event: 'buy', body: '', enabled: true, weight: 1 })}>+ Nowy szablon</button>
        </>
      }
    >
      <DataTable
        rows={rows}
        rowKey={(t) => t.id}
        empty="Brak szablonów"
        columns={[
          { key: 'name', label: 'Nazwa', render: (t) => t.name, sort: (t) => t.name },
          { key: 'cat', label: 'Kategoria', render: (t) => <Badge tone="gray">{t.category}</Badge>, sort: (t) => t.category },
          { key: 'event', label: 'Zdarzenie', render: (t) => CALLOUT_EVENT_LABELS[t.event], sort: (t) => t.event },
          { key: 'body', label: 'Treść', className: 'wrap', render: (t) => <span className="mono small">{t.body}</span> },
          { key: 'w', label: 'Waga', className: 'num', render: (t) => t.weight },
          {
            key: 'on',
            label: 'Aktywny',
            render: (t) => <Toggle checked={t.enabled} onChange={(v) => void api.put(`/api/callouts/templates/${t.id}`, { enabled: v }).then(load).catch((e) => toast(e.message, 'error'))} />,
          },
          {
            key: 'act',
            label: '',
            render: (t) => (
              <div className="row">
                <button className="btn btn-sm" onClick={() => setEdit({ ...t })}>Edytuj</button>
                <ActionButton className="btn-sm btn-ghost" onClick={() => api.del(`/api/callouts/templates/${t.id}`).then(load)} success="Usunięto szablon">Usuń</ActionButton>
              </div>
            ),
          },
        ]}
      />
      {edit && <TemplateEditor draft={edit} onClose={() => setEdit(null)} onSaved={() => void load()} />}
    </Panel>
  );
}

function Import() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  return (
    <Panel title="Import hurtowy">
      <div className="col">
        <div className="small muted">
          Format 1 — linie: <code>zdarzenie | kategoria | treść</code>, np. <code>buy | krótkie | Kupno {'{symbol}'} za {'{value_usd}'} USD</code>.
          <br />
          Format 2 — CSV z nagłówkiem: <code>name,category,event,body,weight</code>. Zdarzenia: <code>{CALLOUT_EVENTS.join(', ')}</code>. Duplikaty (to samo zdarzenie i treść) są pomijane.
        </div>
        <textarea className="mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'buy | ogólne | Kupno {symbol} po {buy_price}\nclose_profit | wyniki | Zysk {pnl_usd} USD na {symbol}'} />
        <div className="row">
          <ActionButton
            className="btn-primary"
            disabled={!text.trim()}
            onClick={async () => {
              const r = await api.post<{ imported: number; skipped: number; errors: string[] }>('/api/callouts/templates/import', { text });
              setResult(r);
              toast(`Zaimportowano ${r.imported}, pominięto ${r.skipped}`, r.errors.length ? 'warn' : 'ok');
            }}
          >
            Importuj
          </ActionButton>
        </div>
        {result && (
          <div className={result.errors.length ? 'warn-box' : 'info-box'}>
            Zaimportowano: {result.imported} · pominięto duplikatów: {result.skipped}
            {result.errors.length > 0 && <ul className="small">{result.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Queue() {
  const callouts = useStore((s) => s.callouts);
  const pending = callouts.filter((c) => c.status === 'pending');
  const [edits, setEdits] = useState<Record<number, string>>({});
  if (!pending.length) return <Panel title="Do zatwierdzenia"><Empty>Brak ogłoszeń oczekujących na zatwierdzenie</Empty></Panel>;
  return (
    <Panel title={`Do zatwierdzenia (${pending.length})`} flush>
      <div className="feed" style={{ maxHeight: 'none' }}>
        {pending.map((c) => (
          <div className="feed-item" key={c.id}>
            <div className="spread">
              <Badge tone="amber">{CALLOUT_EVENT_LABELS[c.event]}</Badge>
              <span className="small faint">{fmtDateTime(c.createdAt)} · transakcja #{c.tradeId}</span>
            </div>
            <textarea rows={2} value={edits[c.id] ?? c.body} onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })} />
            <div className="row">
              <ActionButton className="btn-sm btn-green" onClick={() => api.post(`/api/callouts/${c.id}/approve`, edits[c.id] !== undefined ? { body: edits[c.id] } : {})} success="Zatwierdzono">
                Zatwierdź
              </ActionButton>
              <ActionButton className="btn-sm btn-ghost" onClick={() => api.post(`/api/callouts/${c.id}/reject`)} success="Odrzucono">
                Odrzuć
              </ActionButton>
              <button className="btn btn-sm btn-ghost" onClick={() => void navigator.clipboard.writeText(edits[c.id] ?? c.body).then(() => toast('Skopiowano', 'ok'))}>
                Kopiuj
              </button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CalloutSettings() {
  const stored = useStore((s) => s.settings.callouts);
  const [cfg, setCfg] = useState<CalloutConfig>(stored);
  useEffect(() => setCfg(stored), [stored]);
  const setEv = (e: CalloutEvent, patch: Partial<CalloutConfig['events'][CalloutEvent]>) => setCfg({ ...cfg, events: { ...cfg.events, [e]: { ...cfg.events[e], ...patch } } });
  return (
    <Panel title="Generowanie ogłoszeń" actions={<ActionButton className="btn-primary btn-sm" onClick={() => api.put('/api/settings/callouts', cfg)} success="Zapisano">Zapisz</ActionButton>}>
      <div className="col">
        <div className="row">
          <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} label="Generuj ogłoszenia" />
          <Toggle checked={cfg.requireApproval} onChange={(v) => setCfg({ ...cfg, requireApproval: v })} label="Wymagaj zatwierdzenia" />
          <label className="field" style={{ width: 200 }}>
            <span className="field-label">Etykieta treści automatycznej</span>
            <input value={cfg.autoLabel} onChange={(e) => setCfg({ ...cfg, autoLabel: e.target.value })} />
          </label>
        </div>
        <table>
          <thead>
            <tr><th>Zdarzenie</th><th>Aktywne</th><th>Prawdopodobieństwo</th><th>Min. odstęp</th></tr>
          </thead>
          <tbody>
            {CALLOUT_EVENTS.map((e) => (
              <tr key={e}>
                <td>{CALLOUT_EVENT_LABELS[e]}</td>
                <td><Toggle checked={cfg.events[e].enabled} onChange={(v) => setEv(e, { enabled: v })} /></td>
                <td>
                  <div className="input-unit" style={{ width: 120 }}>
                    <input type="number" min={0} max={100} value={cfg.events[e].probabilityPct} onChange={(ev) => setEv(e, { probabilityPct: Number(ev.target.value) })} />
                    <span>%</span>
                  </div>
                </td>
                <td>
                  <div className="input-unit" style={{ width: 130 }}>
                    <input type="number" min={0} value={cfg.events[e].minIntervalSec} onChange={(ev) => setEv(e, { minIntervalSec: Number(ev.target.value) })} />
                    <span>s</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small muted">Ogłoszenia powstają wyłącznie z rzeczywiście wykonanych transakcji i zawsze mają etykietę treści automatycznej. Moduł niczego nie publikuje na zewnątrz — zatwierdzone treści możesz skopiować.</div>
      </div>
    </Panel>
  );
}

export function Callouts() {
  const [tab, setTab] = useState<Tab>('queue');
  const callouts = useStore((s) => s.callouts);
  const pending = callouts.filter((c) => c.status === 'pending').length;
  return (
    <>
      <div>
        <h1 className="page-title">Callout Manager</h1>
        <div className="page-sub">Szablony i kolejka ogłoszeń o wykonanych operacjach.</div>
      </div>
      <div className="panel">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            ['queue', `Do zatwierdzenia${pending ? ` (${pending})` : ''}`],
            ['feed', 'Feed'],
            ['templates', 'Szablony'],
            ['import', 'Import'],
            ['settings', 'Częstotliwość i zdarzenia'],
          ]}
        />
      </div>
      {tab === 'queue' && <Queue />}
      {tab === 'feed' && <Panel title="Zatwierdzone ogłoszenia" flush><CalloutFeed callouts={callouts.filter((c) => c.status === 'approved')} limit={200} /></Panel>}
      {tab === 'templates' && <Templates />}
      {tab === 'import' && <Import />}
      {tab === 'settings' && <CalloutSettings />}
    </>
  );
}
