import { useEffect, useState } from 'react';
import type { Position, Trade } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Panel } from '../components/ui.tsx';
import { PositionsTable, TradesTable } from '../components/widgets.tsx';
import { useStore } from '../store.ts';
import { useNativeSymbol } from '../chains.ts';

export function Positions() {
  const session = useStore((s) => s.session);
  const openPositions = useStore((s) => s.positions);
  const liveTrades = useStore((s) => s.trades);
  const historyVersion = useStore((s) => s.historyVersion);
  const [closed, setClosed] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const sym = useNativeSymbol();

  useEffect(() => {
    void api.get<Position[]>('/api/positions?status=closed').then(setClosed).catch(() => undefined);
    void api.get<Trade[]>('/api/trades?limit=2000').then(setTrades).catch(() => undefined);
  }, [historyVersion, liveTrades.length]);

  const filtered = trades.filter((t) => side === 'all' || t.side === side);

  return (
    <>
      <div>
        <h1 className="page-title">Pozycje i transakcje</h1>
        <div className="page-sub">Otwarte pozycje z bieżącą wyceną, zamknięte pozycje i pełna historia transakcji.</div>
      </div>
      <Panel title={`Otwarte pozycje (${openPositions.length})`} flush>
        <PositionsTable positions={openPositions} allowSell={!!session} symbol={sym} />
      </Panel>
      <Panel title={`Zamknięte pozycje — ${session ? 'bieżąca sesja' : 'ostatnia sesja'} (${closed.length})`} flush>
        <PositionsTable positions={closed} symbol={sym} />
      </Panel>
      <Panel
        title={`Historia transakcji (${filtered.length})`}
        flush
        actions={
          <>
            <div className="seg">
              {(['all', 'buy', 'sell'] as const).map((s) => (
                <button key={s} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>
                  {s === 'all' ? 'Wszystkie' : s === 'buy' ? 'Kupno' : 'Sprzedaż'}
                </button>
              ))}
            </div>
            {session && (
              <a className="btn btn-sm" href={`/api/sessions/${session.id}/export?format=csv`}>
                Eksport CSV
              </a>
            )}
          </>
        }
      >
        <TradesTable trades={filtered} maxHeight={600} />
      </Panel>
    </>
  );
}
