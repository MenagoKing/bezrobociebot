import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BOT_STATE_LABELS, SCENARIO_LABELS, type BotState, type Scenario, type SessionStatus } from '../../../shared/types.ts';
import { toast, useStore } from '../store.ts';

/** Duży nagłówek strony z ikoną — ten sam wygląd co sekcje Ustawień. */
export function PageHeader(props: { icon: ReactNode; title: string; desc: string }) {
  return (
    <header className="settings-head">
      <span className="settings-head-ico">{props.icon}</span>
      <div>
        <h1 className="settings-title">{props.title}</h1>
        <div className="page-sub">{props.desc}</div>
      </div>
    </header>
  );
}

/** Ikony liniowe do nagłówków stron (1em, kolor z currentColor). */
const svg = (children: ReactNode) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const PageIcons = {
  user: svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>,
  ),
  list: svg(
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </>,
  ),
};

export function Panel(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`panel ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <div className="panel-head">
          <div className="panel-title">{props.title}</div>
          {props.actions && <div className="row">{props.actions}</div>}
        </div>
      )}
      <div className={`panel-body ${props.flush ? 'flush' : ''}`}>{props.children}</div>
    </section>
  );
}

export function Kpi(props: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{props.label}</div>
      <div className={`kpi-value ${props.className ?? ''}`}>{props.value}</div>
      {props.sub !== undefined && <div className="kpi-sub">{props.sub}</div>}
    </div>
  );
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{props.label}</div>
      <div className={`stat-value ${props.className ?? ''}`}>{props.value}</div>
      {props.sub !== undefined && <div className="stat-sub">{props.sub}</div>}
    </div>
  );
}

export function Badge(props: { tone?: 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'cyan'; children: ReactNode; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={`badge b-${props.tone ?? 'gray'}`}>
      {props.dot && <span className={`dot ${props.pulse ? 'pulse' : ''}`} />}
      {props.children}
    </span>
  );
}

const STATE_TONE: Record<BotState, 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'cyan'> = {
  OFFLINE: 'gray',
  IDLE: 'gray',
  WATCHING: 'cyan',
  AWAITING_TASK: 'amber',
  BUYING: 'green',
  HOLDING: 'blue',
  SELLING: 'red',
  PAUSED: 'amber',
  ERROR: 'red',
};
export function StateBadge({ state }: { state: BotState }) {
  const active = ['WATCHING', 'BUYING', 'SELLING', 'AWAITING_TASK', 'HOLDING'].includes(state);
  return (
    <Badge tone={STATE_TONE[state]} dot pulse={active}>
      {BOT_STATE_LABELS[state]}
    </Badge>
  );
}

export const SCENARIO_COLOR: Record<Scenario, string> = {
  AGGRESSIVE_GROWTH: '#19c37d',
  MODERATE_GROWTH: '#5fd39b',
  VOLATILE_GROWTH: '#2dd4e8',
  BASE_BUILDING: '#8b6cff',
  STABLE_MARKET: '#7f8b9c',
  HIGH_VOLATILITY: '#f3b23a',
  DOWNTREND: '#f0454f',
};
export function ScenarioBadge({ scenario, faded }: { scenario: Scenario; faded?: boolean }) {
  const c = SCENARIO_COLOR[scenario];
  return (
    <span className="badge" style={{ color: c, background: `${c}22`, opacity: faded ? 0.55 : 1 }}>
      {SCENARIO_LABELS[scenario]}
    </span>
  );
}

const STATUS_LABEL: Record<SessionStatus, [string, 'green' | 'amber' | 'red' | 'gray']> = {
  running: ['Aktywna', 'green'],
  paused: ['Wstrzymana', 'amber'],
  stopping: ['Zatrzymywanie', 'amber'],
  stopped: ['Zakończona', 'gray'],
  emergency_stopped: ['Zatrzymana awaryjnie', 'red'],
};
export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const [label, tone] = STATUS_LABEL[status];
  return <Badge tone={tone} dot pulse={status === 'running'}>{label}</Badge>;
}

export function ModeBadge({ mode }: { mode: 'paper' | 'live' }) {
  return mode === 'live' ? <Badge tone="red">LIVE</Badge> : <Badge tone="blue">PAPER</Badge>;
}

/** Przycisk wykonujący akcję asynchroniczną z blokadą i komunikatem błędu. */
export function ActionButton(props: {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  success?: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`btn ${props.className ?? ''}`}
      disabled={busy || props.disabled}
      title={props.title}
      onClick={async () => {
        setBusy(true);
        try {
          await props.onClick();
          if (props.success) toast(props.success, 'ok');
        } catch (err) {
          toast((err as Error).message, 'error', 8000);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? '…' : props.children}
    </button>
  );
}

export function Modal(props: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog">
        <div className="modal-head">
          <span>{props.title}</span>
          <button className="btn btn-ghost btn-sm" onClick={props.onClose} aria-label="Zamknij">
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal(props: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Anuluj
          </button>
          <ActionButton
            className={props.danger ? 'btn-red' : 'btn-primary'}
            onClick={async () => {
              await props.onConfirm();
              props.onClose();
            }}
          >
            {props.confirmLabel}
          </ActionButton>
        </>
      }
    >
      {props.children}
    </Modal>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle" style={{ opacity: props.disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="track" />
      {props.label && <span>{props.label}</span>}
    </label>
  );
}

export function Tabs<T extends string>(props: { tabs: [T, ReactNode][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {props.tabs.map(([key, label]) => (
        <button key={key} className={`tab ${props.value === key ? 'on' : ''}`} onClick={() => props.onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
  className?: string;
}

/** Tabela z sortowaniem po kliknięciu nagłówka. */
export function DataTable<T>(props: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: 1 | -1 };
  maxHeight?: number;
}) {
  const [sort, setSort] = useState(props.initialSort ?? null);
  const rows = useMemo(() => {
    if (!sort) return props.rows;
    const col = props.columns.find((c) => c.key === sort.key);
    if (!col?.sort) return props.rows;
    const get = col.sort;
    return [...props.rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [props.rows, props.columns, sort]);
  if (!props.rows.length) return <Empty>{props.empty ?? 'Brak danych'}</Empty>;
  return (
    <div className="table-wrap" style={props.maxHeight ? { maxHeight: props.maxHeight } : undefined}>
      <table>
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th
                key={c.key}
                className={`${c.sort ? 'sortable' : ''} ${c.className ?? ''}`}
                onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={props.rowKey(r)} className={props.onRowClick ? 'clickable' : ''} onClick={() => props.onRowClick?.(r)}>
              {props.columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Odświeżanie co sekundę (np. czasy „x s temu”). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
