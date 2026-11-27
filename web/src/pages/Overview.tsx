import { BOT_STATE_LABELS } from '../../../shared/types.ts';
import { CandleChart } from '../components/charts.tsx';
import { Kpi, Panel, StateBadge, useNow } from '../components/ui.tsx';
import { CalloutFeed, PositionsTable, ScenarioCard, TradesTable } from '../components/widgets.tsx';
import { fmtAgo, fmtCompact, fmtPct, fmtSol, fmtUsd, pnlClass } from '../format.ts';
import { useStore } from '../store.ts';
import { useNativeSymbol } from '../chains.ts';

export function Overview() {
  const stats = useStore((s) => s.stats);
  const session = useStore((s) => s.session);
  const bot = useStore((s) => s.bot);
  const candles = useStore((s) => s.market.candles);
  const snapshot = useStore((s) => s.market.snapshot);
  const analysis = useStore((s) => s.market.analysis);
  const positions = useStore((s) => s.positions);
  const trades = useStore((s) => s.trades);
  const callouts = useStore((s) => s.callouts);
  const wallet = useStore((s) => s.wallet);
  const errors = useStore((s) => s.health?.unacknowledgedErrors ?? 0);
  const now = useNow(1000);
  const sym = useNativeSymbol();
  const solUsd = snapshot?.solUsd ?? wallet.solUsd;
  const active = !!session && session.status !== 'stopping';

  return (
    <>
      <div className="kpis">
        <Kpi
          label="Łączny kapitał"
          value={stats ? fmtUsd(stats.currentCapital.usd) : wallet.solBalance !== null ? fmtUsd(wallet.solBalance * solUsd) : '—'}
          sub={stats ? fmtSol(stats.currentCapital.sol, false, sym) : wallet.solBalance !== null ? `portfel ${fmtSol(wallet.solBalance)}` : 'brak sesji'}
        />
        <Kpi
          label="Wynik finansowy"
          className={pnlClass(stats?.totalPnl.usd)}
          value={stats ? fmtUsd(stats.totalPnl.usd, true) : '—'}
          sub={stats ? `${fmtPct(stats.pnlPct)} · ${fmtSol(stats.totalPnl.sol, true, sym)}` : undefined}
        />
        <Kpi label="Bot" value={<StateBadge state={bot.state} />} sub={active ? `aktywny ${fmtAgo(bot.watchingSince, now).replace(' temu', '')}` : 'nieaktywny'} />
        <Kpi label="Otwarte pozycje" value={positions.length} sub={stats ? `w pozycjach ${fmtUsd(stats.positionsValue.usd)}` : undefined} />
        <Kpi label="Transakcje" value={stats ? stats.buys + stats.sells : 0} sub={stats ? `${stats.buys} kupna · ${stats.sells} sprzedaży` : undefined} />
        <Kpi label="Koszty" value={stats ? fmtUsd(stats.totalCosts.usd) : '—'} sub={stats ? fmtSol(stats.totalCosts.sol, false, sym) : undefined} />
        <Kpi label="Błędy" className={errors ? 'neg' : ''} value={errors} sub={errors ? 'zobacz zakładkę System' : 'brak nowych'} />
      </div>

      <div className="grid g-main">
        <Panel
          title="Wykres ceny i wolumenu"
          actions={
            snapshot && (
              <span className="mono small muted">
                płynność {fmtUsd(snapshot.liquidityUsd)} · wol. 5m {fmtUsd(snapshot.volume5mUsd)} · 24h {fmtCompact(snapshot.volume24hUsd)} USD
              </span>
            )
          }
          flush
        >
          {candles.length ? <CandleChart candles={candles} height={420} /> : <div className="empty" style={{ height: 420, display: 'grid', placeItems: 'center' }}>Rozpocznij sesję w zakładce Session Control, aby zobaczyć wykres</div>}
        </Panel>
        <div className="col">
          <Panel title="Dynamika rynku">
            <ScenarioCard analysis={analysis} />
          </Panel>
          <Panel title="Bot">
            <div className="col small">
              <div className="spread">
                <span className="muted">Stan</span>
                <span>{BOT_STATE_LABELS[bot.state]}</span>
              </div>
              <div className="spread">
                <span className="muted">Obserwuje od</span>
                <span className="mono">{bot.watchingSince ? new Date(bot.watchingSince).toLocaleTimeString('pl-PL') : '—'}</span>
              </div>
              <div className="spread">
                <span className="muted">Ostatnia decyzja</span>
                <span className="mono">{fmtAgo(bot.lastEvaluationAt, now)}</span>
              </div>
              <div className="muted">Sygnał</div>
              <div>{bot.lastSignal ?? '—'}</div>
              {bot.lastAction && (
                <>
                  <div className="muted">Ostatnia operacja</div>
                  <div>{bot.lastAction}</div>
                </>
              )}
              {bot.lastError && <div className="err-box">{bot.lastError}</div>}
            </div>
          </Panel>
        </div>
      </div>

      {positions.length > 0 && (
        <Panel title="Otwarte pozycje" flush>
          <PositionsTable positions={positions} allowSell symbol={sym} />
        </Panel>
      )}

      <div className="grid g-main">
        <Panel title="Ostatnie operacje" flush>
          <TradesTable trades={trades.slice(0, 30)} maxHeight={360} />
        </Panel>
        <Panel title="Feed ogłoszeń" flush>
          <CalloutFeed callouts={callouts} />
        </Panel>
      </div>
    </>
  );
}
