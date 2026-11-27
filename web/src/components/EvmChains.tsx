import { Fragment, useEffect, useState } from 'react';
import type { EvmChainConfig, EvmConfig } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useStore } from '../store.ts';
import { ActionButton, Panel, Toggle } from './ui.tsx';

const EMPTY: EvmChainConfig = {
  key: '',
  name: '',
  chainId: 0,
  enabled: false,
  nativeSymbol: 'ETH',
  rpcUrl: '',
  explorerUrl: '',
  geckoNetwork: '',
  nativePriceRef: 'ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  routerAllowlist: [],
  paperGasFeeNative: 0.00001,
  gasReserveNative: 0.0003,
  simulatedNativeUsd: 1700,
};

function Num({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <input type="number" className="mono" step={step ?? 'any'} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} />;
}

/** Edytor konfiguracji sieci EVM (zapis walidowany po stronie serwera). */
export function EvmChainsPanel() {
  const stored = useStore((s) => s.settings.evm);
  const [cfg, setCfg] = useState<EvmConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setCfg(stored);
  }, [stored, dirty]);

  const setChain = (i: number, patch: Partial<EvmChainConfig>) => {
    setCfg({ ...cfg, chains: cfg.chains.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
    setDirty(true);
  };

  return (
    <Panel
      title="Sieci EVM"
      actions={
        <>
          {dirty && (
            <button className="btn btn-ghost btn-sm" onClick={() => (setCfg(stored), setDirty(false), setError(null))}>
              Odrzuć zmiany
            </button>
          )}
          <button
            className="btn btn-sm"
            onClick={() => {
              setCfg({ ...cfg, chains: [...cfg.chains, { ...EMPTY, key: `siec-${cfg.chains.length + 1}` }] });
              setOpen(`siec-${cfg.chains.length + 1}`);
              setDirty(true);
            }}
          >
            + Dodaj sieć
          </button>
          <ActionButton className="btn-sm" onClick={() => api.post('/api/settings/evm/reset').then(() => setDirty(false))} success="Przywrócono domyślne sieci">
            Domyślne
          </ActionButton>
          <ActionButton
            className="btn-primary btn-sm"
            disabled={!dirty}
            onClick={async () => {
              setError(null);
              try {
                await api.put('/api/settings/evm', cfg);
                setDirty(false);
              } catch (err) {
                setError((err as Error).message);
                throw err;
              }
            }}
            success="Zapisano sieci EVM"
          >
            Zapisz
          </ActionButton>
        </>
      }
    >
      <div className="col">
        {error && <div className="err-box">{error}</div>}
        <label className="field" style={{ maxWidth: 420 }}>
          <span className="field-label">LI.FI API (wyceny i transakcje swapów)</span>
          <input className="mono" value={cfg.lifiBaseUrl} onChange={(e) => (setCfg({ ...cfg, lifiBaseUrl: e.target.value }), setDirty(true))} />
        </label>
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Aktywna</th>
                <th>Sieć</th>
                <th>Klucz</th>
                <th>Chain ID</th>
                <th>Waluta</th>
                <th>RPC</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cfg.chains.map((c, i) => (
                <Fragment key={i}>
                  <tr key={`${c.key}-row`}>
                    <td><Toggle checked={c.enabled} onChange={(v) => setChain(i, { enabled: v })} /></td>
                    <td>{c.name || <span className="faint">bez nazwy</span>}</td>
                    <td className="mono small">{c.key}</td>
                    <td className="mono">{c.chainId}</td>
                    <td>{c.nativeSymbol}</td>
                    <td className="mono small muted">{c.rpcUrl}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => setOpen(open === c.key ? null : c.key)}>
                        {open === c.key ? 'Zwiń' : 'Edytuj'}
                      </button>
                    </td>
                  </tr>
                  {open === c.key && (
                    <tr key={`${c.key}-edit`}>
                      <td colSpan={7} style={{ background: 'var(--bg-2)', whiteSpace: 'normal' }}>
                        <div className="form-grid" style={{ padding: '6px 0' }}>
                          <label className="field"><span className="field-label">Nazwa</span><input value={c.name} onChange={(e) => setChain(i, { name: e.target.value })} /></label>
                          <label className="field"><span className="field-label">Klucz (jak w DexScreener)</span><input className="mono" value={c.key} onChange={(e) => (setChain(i, { key: e.target.value }), setOpen(e.target.value))} /></label>
                          <label className="field"><span className="field-label">Chain ID</span><Num value={c.chainId} step={1} onChange={(v) => setChain(i, { chainId: v })} /></label>
                          <label className="field"><span className="field-label">Waluta natywna</span><input value={c.nativeSymbol} onChange={(e) => setChain(i, { nativeSymbol: e.target.value })} /></label>
                          <label className="field" style={{ gridColumn: 'span 2' }}><span className="field-label">RPC</span><input className="mono" value={c.rpcUrl} onChange={(e) => setChain(i, { rpcUrl: e.target.value })} /></label>
                          <label className="field" style={{ gridColumn: 'span 2' }}><span className="field-label">Eksplorator</span><input className="mono" value={c.explorerUrl} onChange={(e) => setChain(i, { explorerUrl: e.target.value })} /></label>
                          <label className="field"><span className="field-label">Sieć w GeckoTerminal</span><input className="mono" value={c.geckoNetwork} onChange={(e) => setChain(i, { geckoNetwork: e.target.value })} /></label>
                          <label className="field" style={{ gridColumn: 'span 2' }}>
                            <span className="field-label">Wycena waluty natywnej (sieć:adres tokena)</span>
                            <input className="mono" value={c.nativePriceRef} onChange={(e) => setChain(i, { nativePriceRef: e.target.value })} />
                          </label>
                          <label className="field"><span className="field-label">Opłata za transakcję ({c.nativeSymbol})</span><Num value={c.paperGasFeeNative} onChange={(v) => setChain(i, { paperGasFeeNative: v })} /></label>
                          <label className="field"><span className="field-label">Rezerwa na gaz ({c.nativeSymbol})</span><Num value={c.gasReserveNative} onChange={(v) => setChain(i, { gasReserveNative: v })} /></label>
                          <label className="field" style={{ gridColumn: '1 / -1' }}>
                            <span className="field-label">Allowlista kontraktów (router LI.FI) — jeden adres w linii; puste = bez ograniczenia</span>
                            <textarea
                              className="mono"
                              rows={2}
                              value={c.routerAllowlist.join('\n')}
                              onChange={(e) => setChain(i, { routerAllowlist: e.target.value.split(/[\s,]+/).filter(Boolean) })}
                            />
                          </label>
                        </div>
                        <ActionButton
                          className="btn-sm btn-ghost"
                          onClick={() => {
                            setCfg({ ...cfg, chains: cfg.chains.filter((_, j) => j !== i) });
                            setDirty(true);
                          }}
                        >
                          Usuń sieć
                        </ActionButton>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="small muted">
          Token o adresie 0x… jest szukany na włączonych sieciach (wybierana jest ta z największą płynnością). Transakcje live idą przez LI.FI i są podpisywane lokalnie kluczem EVM z zakładki Konta; środki i approve mogą trafić wyłącznie do kontraktów z allowlisty.
        </div>
      </div>
    </Panel>
  );
}
