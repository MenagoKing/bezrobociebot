import { useEffect, useState } from 'react';
import type { Trade } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { PageHeader, PageIcons, Panel } from '../components/ui.tsx';
import { PositionsTable, SellAllButton, TradesTable } from '../components/widgets.tsx';
import { useStore } from '../store.ts';
import { useNativeSymbol } from '../chains.ts';

/** Ile transakcji widać od razu i o ile rozwija się lista. */
const INITIAL = 5;
const STEP = 20;

export function Positions() {
  const session = useStore((s) => s.session);
  const openPositions = useStore((s) => s.positions);
  const liveTrades = useStore((s) => s.trades);
  const historyVersion = useStore((s) => s.historyVersion);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [shown, setShown] = useState(INITIAL);
  const sym = useNativeSymbol();

  useEffect(() => {
    void api.get<Trade[]>('/api/trades?limit=2000').then(setTrades).catch(() => undefined);
  }, [historyVersion, liveTrades.length]);

  // zmiana filtra zaczyna od krótkiej listy
  useEffect(() => setShown(INITIAL), [side]);

  const filtered = trades.filter((t) => side === 'all' || t.side === side).sort((a, b) => b.ts - a.ts);
  const visible = filtered.slice(0, shown);
  const remaining = filtered.length - visible.length;

  return (
    <div className="big-ui">
      <PageHeader icon={PageIcons.list} title="Pozycje" desc="Co bot teraz trzyma i co ostatnio kupił lub sprzedał." />

      <Panel title={`Otwarte pozycje (${openPositions.length})`} flush actions={session && <SellAllButton count={openPositions.length} disabled={session.status === 'stopping'} />}>
        <PositionsTable positions={openPositions} allowSell={!!session} symbol={sym} />
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
        <TradesTable trades={visible} maxHeight={shown > INITIAL ? 640 : undefined} />
        {(remaining > 0 || shown > INITIAL) && (
          <div className="list-more">
            {remaining > 0 && (
              <button className="btn" onClick={() => setShown((n) => n + STEP)}>
                Rozwiń więcej <span className="muted">({remaining} {remaining === 1 ? 'pozostała' : 'pozostało'})</span>
              </button>
            )}
            {shown > INITIAL && (
              <button className="btn btn-ghost" onClick={() => setShown(INITIAL)}>
                Zwiń
              </button>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
