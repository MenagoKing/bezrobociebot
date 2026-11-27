import { CALLOUT_EVENT_LABELS, type Callout, type MarketAnalysis, type Position, type Trade } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { fmtAgo, fmtCompact, fmtPct, fmtPrice, fmtSol, fmtTime, fmtUsd, pnlClass, reasonLabel, shortAddr } from '../format.ts';
import { ActionButton, Badge, DataTable, Empty, ScenarioBadge, useNow } from './ui.tsx';
import { txUrl } from '../chains.ts';
import { useStore } from '../store.ts';

export function TradesTable({ trades, maxHeight }: { trades: Trade[]; maxHeight?: number }) {
  return (
    <DataTable
      rows={trades}
      rowKey={(t) => t.id}
      maxHeight={maxHeight}
      empty="Brak transakcji"
      initialSort={{ key: 'ts', dir: -1 }}
      columns={[
        { key: 'ts', label: 'Czas', render: (t) => <span className="mono">{fmtTime(t.ts)}</span>, sort: (t) => t.ts },
        { key: 'side', label: 'Typ', render: (t) => <Badge tone={t.side === 'buy' ? 'green' : 'red'}>{t.side === 'buy' ? 'KUPNO' : 'SPRZEDAŻ'}</Badge>, sort: (t) => t.side },
        { key: 'sym', label: 'Token', render: (t) => t.tokenSymbol ?? '—' },
        { key: 'price', label: 'Cena', className: 'num', render: (t) => `$${fmtPrice(t.priceUsd)}`, sort: (t) => t.priceUsd },
        { key: 'amount', label: 'Ilość', className: 'num', render: (t) => fmtCompact(t.amount), sort: (t) => t.amount },
        { key: 'usd', label: 'Wartość', className: 'num', render: (t) => fmtUsd(t.valueUsd), sort: (t) => t.valueUsd },
        { key: 'sol', label: 'Waluta sieci', className: 'num', render: (t) => fmtSol(t.valueSol, false, t.nativeSymbol), sort: (t) => t.valueSol },
        { key: 'fee', label: 'Opłaty', className: 'num', render: (t) => fmtSol(t.feeSol + t.networkFeeSol, false, t.nativeSymbol) },
        { key: 'reason', label: 'Powód', render: (t) => <span className="muted">{reasonLabel(t.reason)}</span> },
        {
          key: 'tx',
          label: 'Tx',
          render: (t) =>
            t.txSignature ? (
              <a href={txUrl(t.chain, t.txSignature)} target="_blank" rel="noreferrer" className="mono">
                {shortAddr(t.txSignature, 5)}
              </a>
            ) : (
              <span className="faint">{t.mode === 'paper' ? 'symulacja' : '—'}</span>
            ),
        },
      ]}
    />
  );
}

export function PositionsTable({ positions, allowSell, symbol = 'SOL' }: { positions: Position[]; allowSell?: boolean; symbol?: string }) {
  const now = useNow(1000);
  const extra = useStore((s) => s.wallet.extra);
  const showWallet = extra.length > 0 || positions.some((p) => p.walletId);
  const walletLabel = (id: number) => {
    if (!id) return 'główny';
    const w = extra.find((x) => x.id === id);
    return w ? w.label || shortAddr(w.address, 4) : `#${id}`;
  };
  return (
    <DataTable
      rows={positions}
      rowKey={(p) => p.id}
      empty="Brak otwartych pozycji"
      columns={[
        { key: 'id', label: '#', render: (p) => <span className="mono">{p.id}</span>, sort: (p) => p.id },
        ...(showWallet
          ? [{ key: 'wallet', label: 'Portfel', render: (p: Position) => <span className="small">{walletLabel(p.walletId)}</span>, sort: (p: Position) => p.walletId }]
          : []),
        { key: 'opened', label: 'Otwarta', render: (p) => <span className="mono">{fmtTime(p.openedAt)}</span>, sort: (p) => p.openedAt },
        { key: 'held', label: 'Czas', render: (p) => <span className="mono">{fmtAgo(p.openedAt, p.closedAt ?? now).replace(' temu', '')}</span> },
        { key: 'amount', label: 'Ilość', className: 'num', render: (p) => fmtCompact(p.amount) },
        { key: 'entry', label: 'Wejście', className: 'num', render: (p) => `$${fmtPrice(p.entryPriceUsd)}` },
        { key: 'cost', label: 'Koszt', className: 'num', render: (p) => fmtSol(p.costSol, false, symbol) },
        {
          key: 'pnl',
          label: 'PnL',
          className: 'num',
          sort: (p) => p.unrealizedPnlSol ?? p.realizedPnlSol ?? 0,
          render: (p) => {
            const usd = p.status === 'open' ? p.unrealizedPnlUsd : p.realizedPnlUsd;
            const pct = p.status === 'open' ? p.unrealizedPnlPct : p.costSol ? ((p.realizedPnlSol ?? 0) / p.costSol) * 100 : 0;
            return (
              <span className={pnlClass(usd)}>
                {fmtUsd(usd, true)} <span className="small">({fmtPct(pct)})</span>
              </span>
            );
          },
        },
        {
          key: 'status',
          label: 'Status',
          render: (p) => (p.status === 'open' ? <Badge tone="blue">otwarta</Badge> : <span className="muted small">{reasonLabel(p.exitReason ?? '')}</span>),
        },
        ...(allowSell
          ? [
              {
                key: 'act',
                label: '',
                render: (p: Position) =>
                  p.status === 'open' ? (
                    <ActionButton className="btn-sm btn-red" onClick={() => api.post('/api/commands/sell', { positionId: p.id })} success={`Zlecono sprzedaż pozycji #${p.id}`}>
                      Sprzedaj
                    </ActionButton>
                  ) : null,
              },
            ]
          : []),
      ]}
    />
  );
}

export function CalloutFeed({ callouts, limit = 30 }: { callouts: Callout[]; limit?: number }) {
  const list = callouts.filter((c) => c.status !== 'rejected').slice(0, limit);
  if (!list.length) return <Empty>Brak ogłoszeń — pojawią się po wykonanych transakcjach</Empty>;
  return (
    <div className="feed">
      {list.map((c) => (
        <div className="feed-item" key={c.id}>
          <div className="spread">
            <Badge tone={c.event === 'close_loss' ? 'red' : c.event === 'buy' || c.event === 'close_profit' ? 'green' : 'gray'}>{CALLOUT_EVENT_LABELS[c.event]}</Badge>
            <span className="small faint">
              {c.status === 'pending' ? <span className="warn-text">oczekuje · </span> : null}
              {fmtTime(c.createdAt)}
            </span>
          </div>
          <div>{c.body}</div>
        </div>
      ))}
    </div>
  );
}

export function MetricGrid({ analysis }: { analysis: MarketAnalysis | null }) {
  const m = analysis?.metrics;
  const items: [string, string, string?][] = m
    ? [
        ['Trend', `${m.direction === 'up' ? '↗ wzrostowy' : m.direction === 'down' ? '↘ spadkowy' : '→ boczny'}`, `${fmtPct(m.trendSlopePct, true, 3)} / świecę · R² ${m.trendR2.toFixed(2)}`],
        ['Dynamika (momentum)', fmtPct(m.momentumPct), `przyspieszenie ${fmtPct(m.accelerationPct)}`],
        ['Zmienność', fmtPct(m.volatilityPct, false), 'odch. std. zwrotów / świecę'],
        ['Amplituda wahań', fmtPct(m.amplitudePct, false), `spadek od szczytu ${fmtPct(m.drawdownPct, false)}`],
        ['Wolumen (okno)', fmtUsd(m.volumeWindowUsd), `trend wolumenu ×${m.volumeRatio.toFixed(2)}`],
        ['Płynność', fmtUsd(m.liquidityUsd), ''],
      ]
    : [];
  if (!m) return <Empty>Brak analizy — rozpocznij sesję, aby monitorować token</Empty>;
  return (
    <div className="stat-list">
      {items.map(([label, value, sub]) => (
        <div className="stat" key={label}>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
          {sub && <div className="stat-sub">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function ScenarioCard({ analysis }: { analysis: MarketAnalysis | null }) {
  if (!analysis) return <Empty>Brak danych</Empty>;
  return (
    <div className="col">
      <div className="spread">
        <span className="scenario-big">
          <ScenarioBadge scenario={analysis.scenario} faded={analysis.insufficientData} />
        </span>
        <span className="mono small muted">pewność {(analysis.confidence * 100).toFixed(0)}%</span>
      </div>
      <div className="conf-bar">
        <div style={{ width: `${analysis.confidence * 100}%` }} />
      </div>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 16 }}>
        {analysis.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="small faint">
        {analysis.sampleSize} świec · {fmtTime(analysis.ts)}
      </div>
    </div>
  );
}
