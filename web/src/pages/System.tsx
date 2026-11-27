import { useEffect, useState } from 'react';
import type { ErrorEntry } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { SettingsForm, type FieldGroup } from '../components/settings.tsx';
import { ActionButton, Badge, DataTable, Kpi, Panel } from '../components/ui.tsx';
import { fmtAgo, fmtDateTime, fmtDuration, fmtNum } from '../format.ts';
import { useStore } from '../store.ts';
import { EvmChainsPanel } from '../components/EvmChains.tsx';
import type { AccountInfo } from '../../../shared/types.ts';
import { SecretRow } from './Account.tsx';

const SYSTEM_GROUPS: FieldGroup[] = [
  {
    title: 'Częstotliwości',
    fields: [
      { key: 'marketPollMs', label: 'Odświeżanie ceny', type: 'number', unit: 'ms', step: 500 },
      { key: 'candleRefreshSec', label: 'Odświeżanie świec', type: 'number', unit: 's', step: 5 },
      { key: 'walletPollSec', label: 'Odświeżanie portfela', type: 'number', unit: 's', step: 5 },
      { key: 'equitySnapshotSec', label: 'Migawki kapitału', type: 'number', unit: 's', step: 5 },
    ],
  },
  {
    title: 'Połączenia',
    fields: [
      { key: 'rpcUrl', label: 'Publiczny RPC Solany', type: 'text', help: 'Prywatny URL (z kluczem API) ustawisz w panelu „Prywatny RPC Solany” poniżej' },
      { key: 'jupiterBaseUrl', label: 'Jupiter Swap API', type: 'text' },
    ],
  },
  {
    title: 'Odporność i kopie',
    fields: [
      { key: 'resumeAfterRestart', label: 'Wznawiaj sesję po restarcie', type: 'toggle', help: 'Wyłączone: sesja wraca jako wstrzymana' },
      { key: 'backupIntervalHours', label: 'Kopia zapasowa co', type: 'number', unit: 'h', step: 1, help: '0 = tylko ręcznie' },
      { key: 'backupKeep', label: 'Liczba przechowywanych kopii', type: 'number', step: 1 },
    ],
  },
];

/** Ustawienia → Monitoring: stan procesu, błędy i kopie zapasowe. */
export function SystemMonitoring() {
  const health = useStore((s) => s.health);
  const recent = useStore((s) => s.recentErrors);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [backups, setBackups] = useState<{ file: string; sizeMb: number; createdAt: number }[]>([]);
  const loadErrors = () => void api.get<ErrorEntry[]>('/api/system/errors').then(setErrors).catch(() => undefined);
  const loadBackups = () => void api.get<typeof backups>('/api/system/backups').then(setBackups).catch(() => undefined);
  useEffect(loadErrors, [recent.length]);
  useEffect(loadBackups, []);

  const feed = health?.feed;
  return (
    <>
      <div className="kpis">
        <Kpi label="Czas pracy" value={fmtDuration(health?.uptimeSec)} />
        <Kpi label="CPU procesu" value={`${fmtNum(health?.cpuPct, 1)}%`} sub={health?.loadAvg.some((v) => v > 0) ? `load ${health.loadAvg.map((v) => v.toFixed(2)).join(' / ')}` : undefined} />
        <Kpi label="Pamięć (RSS)" value={`${fmtNum(health?.rssMb, 0)} MB`} sub={`heap ${fmtNum(health?.heapUsedMb, 0)} MB · system ${fmtNum(health?.systemMemUsedPct, 0)}%`} />
        <Kpi label="Opóźnienie pętli" value={`${fmtNum(health?.eventLoopLagMs, 1)} ms`} />
        <Kpi label="Kolejka zleceń" value={health?.queueLength ?? 0} sub={`klienci panelu: ${health?.sseClients ?? 0}`} />
        <Kpi label="Baza danych" value={`${fmtNum(health?.dbSizeMb, 2)} MB`} sub={`kopia: ${fmtAgo(health?.lastBackupAt)}`} />
        <Kpi
          label="Feed rynkowy"
          value={<Badge tone={feed?.status === 'ok' ? 'green' : feed?.status === 'idle' ? 'gray' : feed?.status === 'degraded' ? 'amber' : 'red'} dot>{feed?.status ?? '—'}</Badge>}
          sub={feed?.lastError ?? (feed?.lastTickAt ? `tick ${fmtAgo(feed.lastTickAt)}` : '')}
        />
      </div>
      <Panel
        title={`Monitor błędów (${health?.unacknowledgedErrors ?? 0} nowych)`}
        flush
        actions={
          <>
            <ActionButton className="btn-sm" onClick={loadErrors}>Odśwież</ActionButton>
            <ActionButton className="btn-sm btn-primary" onClick={() => api.post('/api/system/errors/ack').then(loadErrors)} success="Oznaczono jako przejrzane">Oznacz jako przejrzane</ActionButton>
          </>
        }
      >
        <DataTable
          rows={errors}
          rowKey={(e) => e.id}
          maxHeight={420}
          empty="Brak zarejestrowanych błędów"
          columns={[
            { key: 'ts', label: 'Czas', render: (e) => <span className="mono">{fmtDateTime(e.ts)}</span>, sort: (e) => e.ts },
            { key: 'level', label: 'Poziom', render: (e) => <Badge tone={e.level === 'error' ? 'red' : 'amber'}>{e.level}</Badge>, sort: (e) => e.level },
            { key: 'src', label: 'Moduł', render: (e) => <span className="mono small">{e.source}</span>, sort: (e) => e.source },
            { key: 'msg', label: 'Komunikat', className: 'wrap', render: (e) => <span className={e.acknowledged ? 'muted' : ''}>{e.message}</span> },
          ]}
        />
      </Panel>
      <Panel
        title="Kopie zapasowe bazy"
        flush
        actions={<ActionButton className="btn-sm btn-primary" onClick={() => api.post('/api/system/backup').then(loadBackups)} success="Kopia utworzona">Utwórz kopię teraz</ActionButton>}
      >
        <DataTable
          rows={backups}
          rowKey={(b) => b.file}
          maxHeight={260}
          empty="Brak kopii"
          columns={[
            { key: 'file', label: 'Plik', render: (b) => <span className="mono small">{b.file}</span> },
            { key: 'size', label: 'Rozmiar', className: 'num', render: (b) => `${b.sizeMb.toFixed(2)} MB` },
            { key: 'at', label: 'Utworzono', render: (b) => fmtDateTime(b.createdAt) },
          ]}
        />
        <div className="panel-body small muted">Kopie trafiają do data/backups. Klucz główny (data/master.key lub MASTER_KEY) przechowuj osobno — bez niego zaszyfrowanych sekretów nie da się odczytać.</div>
      </Panel>
    </>
  );
}

/** Ustawienia → Sieci i połączenia: sieci EVM, RPC, częstotliwości odświeżania i kopie. */
/** Prywatny RPC Solany (zaszyfrowany sekret) — przeniesiony tu z zakładki Konta. */
function PrivateRpcPanel() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  useEffect(() => {
    void api.get<AccountInfo>('/api/account').then(setAccount).catch(() => undefined);
  }, []);
  const rpc = account?.secrets.find((s) => s.name === 'rpc_url');
  return (
    <Panel title="Prywatny RPC Solany (zaszyfrowany)">
      {rpc ? <SecretRow name="rpc_url" info={rpc} onChange={setAccount} /> : <div className="muted">Ładowanie…</div>}
      <div className="small muted mt">
        Adres jest szyfrowany kluczem głównym (MASTER_KEY lub data/master.key), który nie jest zapisany w bazie. Darmowy prywatny RPC dają np. Helius, QuickNode i Triton.
      </div>
    </Panel>
  );
}

export function SystemConnections() {
  return (
    <>
      <SettingsForm section="system" title="Połączenia, odświeżanie i kopie zapasowe" groups={SYSTEM_GROUPS} />
      <PrivateRpcPanel />
      <EvmChainsPanel />
    </>
  );
}
