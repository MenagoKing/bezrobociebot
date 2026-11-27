import type { ReactNode } from 'react';
import { CandleChart, TimeframeChart } from '../components/charts.tsx';
import { Panel } from '../components/ui.tsx';
import { useStore } from '../store.ts';

const CHART_HEIGHT = 460;

/** Panel aktywnej sesji na żywo (zakładka „Start”): wykres tokena z nagłówkiem. Reszta widoku sesji jest w przebudowie. */
export function Dashboard({ chartHead }: { chartHead?: ReactNode }) {
  const session = useStore((s) => s.session);
  const candles = useStore((s) => s.market.candles);
  const token = useStore((s) => s.token);
  const baseTf = useStore((s) => s.settings.analysis.timeframeSec);

  return (
    <div className="grid ov-main">
      <Panel title={chartHead ? undefined : 'Wykres ceny i wolumenu'} flush>
        {chartHead}
        {token ? (
          <TimeframeChart address={token.address} baseCandles={candles} baseTf={baseTf} height={CHART_HEIGHT} empty="Czekam na pierwsze świece z rynku…" />
        ) : candles.length ? (
          <CandleChart candles={candles} height={CHART_HEIGHT} />
        ) : (
          <div className="empty" style={{ height: CHART_HEIGHT, display: 'grid', placeItems: 'center' }}>
            {session ? 'Czekam na pierwsze świece z rynku…' : 'Wykres pojawi się po rozpoczęciu sesji'}
          </div>
        )}
      </Panel>
    </div>
  );
}
