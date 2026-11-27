import { SCENARIO_LABELS, SCENARIOS } from '../../../shared/types.ts';
import { CandleChart } from '../components/charts.tsx';
import { PresetBar, SettingsForm, type FieldGroup } from '../components/settings.tsx';
import { Badge, Panel, SCENARIO_COLOR, ScenarioBadge } from '../components/ui.tsx';
import { MetricGrid, ScenarioCard } from '../components/widgets.tsx';
import { fmtAgo, fmtTime } from '../format.ts';
import { useStore } from '../store.ts';

const ANALYSIS_GROUPS: FieldGroup[] = [
  {
    title: 'Okno analizy',
    fields: [
      { key: 'timeframeSec', label: 'Interwał świecy', type: 'select', options: [['60', '1 min'], ['300', '5 min'], ['900', '15 min'], ['3600', '1 h']] },
      { key: 'lookbackCandles', label: 'Liczba świec w oknie', type: 'number', step: 1 },
      { key: 'momentumBars', label: 'Świece dla momentum', type: 'number', step: 1 },
      { key: 'minSamples', label: 'Min. świec do klasyfikacji', type: 'number', step: 1 },
    ],
  },
  {
    title: 'Progi trendu (% na świecę)',
    fields: [
      { key: 'aggressiveSlopePct', label: 'Aggressive Growth: nachylenie ≥', type: 'number', unit: '%', step: 0.05 },
      { key: 'aggressiveMomentumPct', label: 'Aggressive Growth: momentum ≥', type: 'number', unit: '%', step: 0.5 },
      { key: 'moderateSlopePct', label: 'Moderate Growth: nachylenie ≥', type: 'number', unit: '%', step: 0.05 },
      { key: 'downSlopePct', label: 'Downtrend: nachylenie ≤ −', type: 'number', unit: '%', step: 0.05 },
      { key: 'flatSlopePct', label: 'Trend płaski: |nachylenie| <', type: 'number', unit: '%', step: 0.01 },
    ],
  },
  {
    title: 'Progi zmienności i konsolidacji',
    fields: [
      { key: 'volatileGrowthVolPct', label: 'Volatile Growth: zmienność ≥', type: 'number', unit: '%', step: 0.1 },
      { key: 'highVolPct', label: 'High Volatility: zmienność ≥', type: 'number', unit: '%', step: 0.1 },
      { key: 'stableMaxVolPct', label: 'Stable Market: zmienność ≤', type: 'number', unit: '%', step: 0.1 },
      { key: 'baseMaxAmplitudePct', label: 'Base Building: amplituda ≤', type: 'number', unit: '%', step: 0.5 },
      { key: 'baseMinVolumeRatio', label: 'Base Building: trend wolumenu ≥', type: 'number', unit: '×', step: 0.05 },
    ],
  },
];

/** Ustawienia → Analiza rynku: wskaźniki na żywo, historia scenariuszy i konfiguracja klasyfikacji. */
export function MarketDynamics() {
  const analysis = useStore((s) => s.market.analysis);
  const candles = useStore((s) => s.market.candles);
  const feed = useStore((s) => s.market.feed);
  const history = useStore((s) => s.scenarioHistory);
  const timeframe = useStore((s) => s.settings.analysis.timeframeSec);
  const now = Date.now();
  const span = history.length ? Math.max(1, now - history[0]!.ts) : 1;

  return (
    <>
      <div className="spread">
        <span className="small muted">Stan źródła danych rynkowych</span>
        <Badge tone={feed.status === 'ok' ? 'green' : feed.status === 'idle' ? 'gray' : feed.status === 'degraded' ? 'amber' : 'red'} dot>
          feed: {feed.status} {feed.lastTickAt ? `· ${fmtAgo(feed.lastTickAt)}` : ''}
        </Badge>
      </div>
      <div className="grid g-main">
        <Panel title="Wskaźniki" flush>
          <MetricGrid analysis={analysis} />
        </Panel>
        <Panel title="Aktualny scenariusz">
          <ScenarioCard analysis={analysis} />
        </Panel>
      </div>
      <Panel title="Historia scenariuszy (bieżąca sesja)">
        {history.length ? (
          <div className="col">
            <div className="timeline">
              {history.map((h, i) => {
                const end = history[i + 1]?.ts ?? now;
                return <div key={h.ts} title={`${SCENARIO_LABELS[h.scenario]} od ${fmtTime(h.ts)}`} style={{ flex: (end - h.ts) / span, background: SCENARIO_COLOR[h.scenario] }} />;
              })}
            </div>
            <div className="row small">
              {history.slice(-8).reverse().map((h) => (
                <span key={h.ts} className="row" style={{ gap: 4 }}>
                  <span className="mono faint">{fmtTime(h.ts)}</span>
                  <ScenarioBadge scenario={h.scenario} />
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="muted">Historia pojawi się w trakcie sesji.</div>
        )}
        <div className="row small mt">
          {SCENARIOS.map((s) => (
            <span key={s} className="row" style={{ gap: 5 }}>
              <span className="dot" style={{ color: SCENARIO_COLOR[s] }} />
              <span className="muted">{SCENARIO_LABELS[s]}</span>
            </span>
          ))}
        </div>
      </Panel>
      {candles.length > 0 && (
        <Panel title={`Wykres (${timeframe >= 60 ? `${timeframe / 60} min` : `${timeframe} s`})`} flush>
          <CandleChart candles={candles} height={320} />
        </Panel>
      )}
      <PresetBar kind="analysis" />
      <SettingsForm section="analysis" title="Konfiguracja analizy" groups={ANALYSIS_GROUPS} />
    </>
  );
}
