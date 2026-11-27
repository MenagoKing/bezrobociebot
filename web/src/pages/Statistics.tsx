import { useEffect, useState } from 'react';
import type { EquityPoint, Position, SessionRecord, SessionStats, Trade } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { EquityChart } from '../components/charts.tsx';
import { DataTable, Empty, ModeBadge, Modal, Panel, SessionStatusBadge, Stat } from '../components/ui.tsx';
import { PositionsTable, TradesTable } from '../components/widgets.tsx';
import { fmtDateTime, fmtDuration, fmtPct, fmtSol, fmtUsd, pnlClass } from '../format.ts';
import { useStore } from '../store.ts';
import { chainName } from '../chains.ts';

interface SessionDetail {
  session: SessionRecord;
  stats: SessionStats | null;
  positions: Position[];
  trades: Trade[];
  equity: EquityPoint[];
}

export function StatsGrid({ stats }: { stats: SessionStats }) {
  const sym = stats.nativeSymbol ?? 'SOL';
  const m = (v: { sol: number; usd: number }, signed = false) => ({ value: fmtUsd(v.usd, signed), sub: fmtSol(v.sol, signed, sym) });
  const items: [string, { value: string; sub: string }, string?][] = [
    ['Kapitał początkowy', m(stats.startCapital)],
    ['Kapitał aktualny', m(stats.currentCapital)],
    ['Wynik łączny', m(stats.totalPnl, true), pnlClass(stats.totalPnl.usd)],
    ['Wynik procentowy', { value: fmtPct(stats.pnlPct), sub: `${stats.wins} zysk. / ${stats.losses} strat.` }, pnlClass(stats.pnlPct)],
    ['Zrealizowany PNL', m(stats.realizedPnl, true), pnlClass(stats.realizedPnl.usd)],
    ['Niezrealizowany PNL', m(stats.unrealizedPnl, true), pnlClass(stats.unrealizedPnl.usd)],
    ['Saldo dostępne', m(stats.balance)],
    ['Wartość pozycji', m(stats.positionsValue)],
    ['Prowizje platformy', m(stats.platformFees)],
    ['Opłaty sieci', m(stats.networkFees)],
    ...(sym === 'SOL' ? [['Rent kont tokenów', m(stats.rent)] as [string, { value: string; sub: string }]] : []),
    ['Koszty łącznie', m(stats.totalCosts)],
    ['Liczba zakupów', { value: String(stats.buys), sub: '' }],
    ['Liczba sprzedaży', { value: String(stats.sells), sub: `${stats.openPositions} otwartych poz.` }],
    ['Łączna wartość transakcji', m(stats.totalVolume)],
    ['Średnia wartość transakcji', m(stats.avgTrade)],
    ['Czas trwania sesji', { value: fmtDuration(stats.durationSec), sub: `${sym}/USD ${stats.solUsd.toFixed(2)}` }],
  ];
  return (
    <div className="stat-list">
      {items.map(([label, v, cls]) => (
        <Stat key={label} label={label} value={v.value} sub={v.sub} className={cls} />
      ))}
    </div>
  );
}

function SessionModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<SessionDetail | null>(null);
  useEffect(() => {
    void api.get<SessionDetail>(`/api/sessions/${id}`).then(setD).catch(() => undefined);
  }, [id]);
  return (
    <Modal
      title={d ? `Sesja #${id} — ${d.session.tokenSymbol}` : `Sesja #${id}`}
      onClose={onClose}
      wide
      footer={
        <>
          <a className="btn" href={`/api/sessions/${id}/export?format=csv`}>Transakcje CSV</a>
          <a className="btn btn-primary" href={`/api/sessions/${id}/export?format=json`}>Raport JSON</a>
        </>
      }
    >
      {!d ? (
        <div className="muted">Ładowanie…</div>
      ) : (
        <>
          <div className="row">
            <ModeBadge mode={d.session.mode} />
            <SessionStatusBadge status={d.session.status} />
            <span className="muted small">
              {chainName(d.session.chain)} · {fmtDateTime(d.session.startedAt)} → {fmtDateTime(d.session.endedAt)} · {d.session.tokenName}
            </span>
          </div>
          {d.stats && <StatsGrid stats={d.stats} />}
          <Panel title="Historia zmian kapitału (USD)" flush>
            {d.equity.length > 1 ? <EquityChart points={d.equity} height={220} /> : <Empty>Za mało punktów</Empty>}
          </Panel>
          <Panel title="Pozycje" flush>
            <PositionsTable positions={d.positions} symbol={d.session.nativeSymbol} />
          </Panel>
          <Panel title="Transakcje" flush>
            <TradesTable trades={d.trades} maxHeight={300} />
          </Panel>
        </>
      )}
    </Modal>
  );
}

export function Statistics() {
  const stats = useStore((s) => s.stats);
  const session = useStore((s) => s.session);
  const historyVersion = useStore((s) => s.historyVersion);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    void api.get<SessionRecord[]>('/api/sessions').then(setSessions).catch(() => undefined);
  }, [historyVersion]);

  useEffect(() => {
    if (!session) return setEquity([]);
    const load = () => void api.get<SessionDetail>(`/api/sessions/${session.id}`).then((d) => setEquity(d.equity)).catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [session?.id]);

  const finished = sessions.filter((s) => !['running', 'paused', 'stopping'].includes(s.status));

  return (
    <>
      <div>
        <h1 className="page-title">Statystyki finansowe</h1>
        <div className="page-sub">Wyniki bieżącej sesji i historia zakończonych sesji — w SOL i USD.</div>
      </div>
      {stats && session ? (
        <>
          <Panel title={`Bieżąca sesja #${session.id} — ${session.tokenSymbol}`} flush actions={<a className="btn btn-sm" href={`/api/sessions/${session.id}/export?format=json`}>Eksport raportu</a>}>
            <StatsGrid stats={stats} />
          </Panel>
          <Panel title="Historia zmian kapitału (USD)" flush>
            {equity.length > 1 ? <EquityChart points={equity} /> : <Empty>Wykres pojawi się po kilku migawkach kapitału</Empty>}
          </Panel>
        </>
      ) : (
        <Panel title="Bieżąca sesja"><Empty>Brak aktywnej sesji</Empty></Panel>
      )}
      <Panel title={`Zakończone sesje (${finished.length})`} flush>
        <DataTable
          rows={finished}
          rowKey={(s) => s.id}
          onRowClick={(s) => setOpen(s.id)}
          empty="Brak zakończonych sesji"
          initialSort={{ key: 'id', dir: -1 }}
          columns={[
            { key: 'id', label: '#', render: (s) => <span className="mono">{s.id}</span>, sort: (s) => s.id },
            { key: 'token', label: 'Token', render: (s) => <b>{s.tokenSymbol}</b>, sort: (s) => s.tokenSymbol },
            { key: 'chain', label: 'Sieć', render: (s) => chainName(s.chain), sort: (s) => s.chain },
            { key: 'mode', label: 'Tryb', render: (s) => <ModeBadge mode={s.mode} /> },
            { key: 'start', label: 'Start', render: (s) => <span className="mono">{fmtDateTime(s.startedAt)}</span>, sort: (s) => s.startedAt },
            { key: 'dur', label: 'Czas', render: (s) => fmtDuration(s.summary?.durationSec), sort: (s) => s.summary?.durationSec ?? 0 },
            { key: 'trades', label: 'Transakcje', className: 'num', render: (s) => (s.summary ? s.summary.buys + s.summary.sells : '—') },
            { key: 'start$', label: 'Kapitał pocz.', className: 'num', render: (s) => fmtUsd(s.startCapitalUsd) },
            {
              key: 'pnl',
              label: 'Wynik',
              className: 'num',
              sort: (s) => s.summary?.totalPnl.usd ?? 0,
              render: (s) => (s.summary ? <span className={pnlClass(s.summary.totalPnl.usd)}>{fmtUsd(s.summary.totalPnl.usd, true)} ({fmtPct(s.summary.pnlPct)})</span> : '—'),
            },
            { key: 'costs', label: 'Koszty', className: 'num', render: (s) => (s.summary ? fmtUsd(s.summary.totalCosts.usd) : '—') },
            { key: 'status', label: 'Status', render: (s) => <SessionStatusBadge status={s.status} /> },
          ]}
        />
      </Panel>
      {open !== null && <SessionModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
