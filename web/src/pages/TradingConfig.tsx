import type { TradingConfig as TC } from '../../../shared/types.ts';
import { PresetBar, SettingsForm, type FieldGroup } from '../components/settings.tsx';
import { fmtPct, fmtSol, fmtUsd } from '../format.ts';
import { useStore } from '../store.ts';

const TRADING_GROUPS: FieldGroup[] = [
  {
    title: 'Kwoty transakcji',
    fields: [
      { key: 'minTradeUsd', label: 'Minimalna kwota', type: 'number', unit: 'USD', step: 0.05 },
      { key: 'maxTradeUsd', label: 'Maksymalna kwota', type: 'number', unit: 'USD', step: 0.05 },
      { key: 'tradeSizing', label: 'Wielkość transakcji', type: 'select', options: [['random', 'Losowa z zakresu min–max'], ['fixed', 'Stała']] },
      { key: 'fixedTradeUsd', label: 'Stała kwota', type: 'number', unit: 'USD', step: 0.05, help: 'Używana przy wielkości „Stała”' },
    ],
  },
  {
    title: 'Czas',
    fields: [
      { key: 'minHoldSeconds', label: 'Min. czas utrzymywania pozycji', type: 'number', unit: 's', step: 1 },
      { key: 'maxHoldSeconds', label: 'Maks. czas utrzymywania', type: 'number', unit: 's', step: 1, help: '0 = bez limitu' },
      { key: 'buyCooldownSeconds', label: 'Odstęp między zakupami', type: 'number', unit: 's', step: 1 },
      { key: 'evaluationIntervalSeconds', label: 'Częstotliwość decyzji', type: 'number', unit: 's', step: 1 },
    ],
  },
  {
    title: 'Wyjście z pozycji',
    fields: [
      { key: 'takeProfitPct', label: 'Take profit', type: 'number', unit: '%', step: 0.5, help: '0 = wyłączone' },
      { key: 'stopLossPct', label: 'Stop loss', type: 'number', unit: '%', step: 0.5, help: 'Po min. czasie trzymania' },
      { key: 'trailingStopPct', label: 'Trailing stop', type: 'number', unit: '%', step: 0.5, help: 'Od szczytu, gdy pozycja była na plusie' },
      { key: 'hardStopLossPct', label: 'Twardy stop loss', type: 'number', unit: '%', step: 0.5, help: 'Działa zawsze, także przed min. czasem' },
      { key: 'exitOnScenarios', label: 'Wyjście przy scenariuszach', type: 'scenarios' },
    ],
  },
  {
    title: 'Wejście w pozycję',
    fields: [
      { key: 'entryScenarios', label: 'Kupuj tylko przy scenariuszach', type: 'scenarios', help: 'Pusta lista = strategia nie kupuje (tylko polecenia ręczne)' },
      { key: 'minConfidence', label: 'Min. pewność klasyfikacji', type: 'number', step: 0.05, min: 0, max: 1, help: '0–1' },
      { key: 'maxOpenPositions', label: 'Maks. liczba otwartych pozycji', type: 'number', step: 1, min: 1 },
      { key: 'minLiquidityUsd', label: 'Min. płynność tokena', type: 'number', unit: 'USD', step: 100 },
    ],
  },
  {
    title: 'Wykonanie (live, wszystkie sieci)',
    fields: [
      { key: 'slippageBps', label: 'Maks. poślizg', type: 'number', unit: 'bps', step: 10, help: '100 bps = 1%' },
      { key: 'priorityFeeLamports', label: 'Opłata priorytetowa (Solana)', type: 'number', unit: 'lamport', step: 10000, help: '1 SOL = 1 000 000 000 lamportów. Gaz w sieciach EVM ustala RPC.' },
    ],
  },
  {
    title: 'Symulacja (paper)',
    fields: [
      { key: 'paperStartingCapitalUsd', label: 'Domyślny kapitał początkowy', type: 'number', unit: 'USD', step: 0.1 },
      { key: 'paperPlatformFeePct', label: 'Prowizja platformy', type: 'number', unit: '%', step: 0.05 },
      { key: 'paperNetworkFeeSol', label: 'Opłata bazowa sieci (Solana)', type: 'number', unit: 'SOL', step: 0.000001, help: 'Dla sieci EVM: System → Sieci EVM' },
      { key: 'paperSlippagePct', label: 'Poślizg symulowany', type: 'number', unit: '%', step: 0.1 },
      { key: 'paperAtaRentSol', label: 'Rent konta tokena (Solana)', type: 'number', unit: 'SOL', step: 0.0001, help: 'Jednorazowo przy pierwszym zakupie; sieci EVM nie mają rentu' },
    ],
  },
];

const RISK_GROUPS: FieldGroup[] = [
  {
    title: 'Limity kapitału',
    fields: [
      { key: 'maxDeployedUsd', label: 'Maks. kapitał w pozycjach', type: 'number', unit: 'USD', step: 0.1 },
      { key: 'maxDeployedPctOfEquity', label: 'Maks. udział kapitału w pozycjach', type: 'number', unit: '%', step: 5 },
      { key: 'solReserve', label: 'Rezerwa SOL na opłaty (Solana)', type: 'number', unit: 'SOL', step: 0.0005, help: 'Rezerwa dla sieci EVM: System → Sieci EVM' },
    ],
  },
  {
    title: 'Limity strat i kosztów',
    fields: [
      { key: 'maxSessionLossUsd', label: 'Maks. strata sesji', type: 'number', unit: 'USD', step: 0.1, help: '0 = wyłączone' },
      { key: 'maxSessionLossPct', label: 'Maks. strata sesji', type: 'number', unit: '%', step: 1, help: '0 = wyłączone' },
      { key: 'maxCostsUsd', label: 'Maks. koszty (prowizje + opłaty + rent)', type: 'number', unit: 'USD', step: 0.1, help: '0 = wyłączone' },
      { key: 'onLimitBreach', label: 'Po przekroczeniu limitu', type: 'select', options: [['pause', 'Wstrzymaj sesję'], ['stop_and_liquidate', 'Zatrzymaj i sprzedaj wszystko']] },
    ],
  },
  {
    title: 'Limity aktywności',
    fields: [
      { key: 'maxTradesPerSession', label: 'Maks. transakcji w sesji', type: 'number', step: 1 },
      { key: 'maxTradesPerHour', label: 'Maks. transakcji na godzinę', type: 'number', step: 1 },
    ],
  },
  {
    title: 'Awarie i bezpieczeństwo',
    fields: [
      { key: 'emergencyLiquidate', label: 'Emergency Stop sprzedaje pozycje', type: 'toggle' },
      { key: 'pauseKeepsHardStop', label: 'Twardy stop loss działa w pauzie', type: 'toggle' },
      { key: 'maxOrderRetries', label: 'Liczba prób zlecenia', type: 'number', step: 1 },
      { key: 'errorRecoverySeconds', label: 'Automatyczne wznowienie po błędzie', type: 'number', unit: 's', step: 5 },
      { key: 'maxDataAgeSeconds', label: 'Maks. wiek danych rynkowych', type: 'number', unit: 's', step: 5, help: 'Starsze dane blokują decyzje' },
    ],
  },
];

/** Szacunek kosztu pełnego cyklu (kupno + sprzedaż) dla danej kwoty — pomaga ocenić sens małych transakcji. */
function CostEstimator({ cfg }: { cfg: TC }) {
  const solUsd = useStore((s) => s.market.snapshot?.solUsd ?? (s.wallet.solUsd || s.settings.system.simulatedSolUsd));
  const sizes = [cfg.minTradeUsd, (cfg.minTradeUsd + cfg.maxTradeUsd) / 2, cfg.maxTradeUsd];
  const net = cfg.paperNetworkFeeSol + cfg.priorityFeeLamports / 1e9;
  return (
    <div className="panel" style={{ background: 'var(--bg-2)' }}>
      <div className="panel-head"><div className="panel-title">Koszt pełnego cyklu na Solanie (szacunek)</div></div>
      <div className="panel-body col small">
        {sizes.map((usd) => {
          const fees = (usd * cfg.paperPlatformFeePct * 2) / 100 + usd * (cfg.paperSlippagePct * 2) / 100 + net * 2 * solUsd;
          const withRent = fees + cfg.paperAtaRentSol * solUsd;
          return (
            <div key={usd} className="spread">
              <span className="mono">{fmtUsd(usd)}</span>
              <span className="mono">
                {fmtUsd(fees)} <span className="muted">({fmtPct((fees / usd) * 100, false, 1)})</span>
                <span className="faint"> · z rentem {fmtPct((withRent / usd) * 100, false, 0)}</span>
              </span>
            </div>
          );
        })}
        <div className="faint">
          Prowizja {cfg.paperPlatformFeePct}% ×2, poślizg {cfg.paperSlippagePct}% ×2, opłaty sieci {fmtSol(net * 2)}, rent {fmtSol(cfg.paperAtaRentSol)} (jednorazowo). Pozycja musi zyskać co najmniej tyle, by wyjść na zero.
        </div>
      </div>
    </div>
  );
}

export function TradingConfig() {
  return (
    <>
      <div>
        <h1 className="page-title">Trading Configuration</h1>
        <div className="page-sub">Parametry strategii i limity ryzyka. Zmiany działają od następnego cyklu decyzji — bez restartu.</div>
      </div>
      <PresetBar kind="trading" />
      <SettingsForm section="trading" title="Strategia i wykonanie" groups={TRADING_GROUPS} aside={(draft) => <CostEstimator cfg={draft} />} />
      <SettingsForm section="risk" title="Limity ryzyka" groups={RISK_GROUPS} />
    </>
  );
}
