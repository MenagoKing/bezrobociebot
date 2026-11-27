import { useEffect, useState } from 'react';
import { BOT_STATES, BOT_STATE_LABELS, type DataSource, type ExecutionMode, type TokenInfo } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ActionButton, Badge, ConfirmModal, DataTable, ModeBadge, Panel, SessionStatusBadge, Toggle, useNow } from '../components/ui.tsx';
import { PositionsTable } from '../components/widgets.tsx';
import { fmtCompact, fmtDuration, fmtPrice, fmtSol, fmtTime, fmtUsd, reasonLabel, shortAddr } from '../format.ts';
import { toast, useStore } from '../store.ts';
import { chainName, tokenLinks, useNativeSymbol } from '../chains.ts';

function TokenLinks({ chain, address }: { chain: string; address: string }) {
  return (
    <div className="row small">
      {tokenLinks(chain, address).map(([label, url]) => (
        <a key={label} href={url} target="_blank" rel="noreferrer">
          {label} ↗
        </a>
      ))}
    </div>
  );
}

function TokenCard({ token }: { token: TokenInfo }) {
  return (
    <div className="panel" style={{ background: 'var(--bg-2)' }}>
      <div className="panel-body col">
        <div className="row">
          {token.imageUrl && <img src={token.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />}
          <div>
            <div className="row" style={{ fontWeight: 700, fontSize: 15, gap: 8 }}>
              <span>
                {token.name} <span className="muted">({token.symbol})</span>
              </span>
              <span className="badge b-cyan">{chainName(token.chain)}</span>
            </div>
            <div className="mono small faint">{token.address}</div>
          </div>
        </div>
        <div className="stat-list" style={{ borderRadius: 8, overflow: 'hidden' }}>
          <div className="stat"><div className="stat-label">Cena</div><div className="stat-value">${fmtPrice(token.priceUsd)}</div><div className="stat-sub">{fmtPrice(token.priceSol)} {token.nativeSymbol}</div></div>
          <div className="stat"><div className="stat-label">Płynność</div><div className="stat-value">{fmtUsd(token.liquidityUsd)}</div></div>
          <div className="stat"><div className="stat-label">Market cap</div><div className="stat-value">{fmtCompact(token.marketCapUsd)} USD</div></div>
          <div className="stat"><div className="stat-label">Wolumen 24h</div><div className="stat-value">{fmtCompact(token.volume24hUsd)} USD</div></div>
          <div className="stat"><div className="stat-label">Para</div><div className="stat-value">{token.dexId} / {token.quoteSymbol}</div><div className="stat-sub">{shortAddr(token.pairAddress)}</div></div>
        </div>
        {token.dexId !== 'simulator' && <TokenLinks chain={token.chain} address={token.address} />}
      </div>
    </div>
  );
}

function StartForm() {
  const meta = useStore((s) => s.meta);
  const paperCapital = useStore((s) => s.settings.trading.paperStartingCapitalUsd);
  const [address, setAddress] = useState('');
  const [source, setSource] = useState<DataSource>('live');
  const [mode, setMode] = useState<ExecutionMode>('paper');
  const [capital, setCapital] = useState(paperCapital);
  const [phrase, setPhrase] = useState('');
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = address.trim();
    setToken(null);
    setError(null);
    if (a.length < 32) return;
    setResolving(true);
    const t = setTimeout(() => {
      api
        .get<TokenInfo>(`/api/token/resolve?address=${encodeURIComponent(a)}&source=${source}`)
        .then(setToken)
        .catch((e) => setError((e as Error).message))
        .finally(() => setResolving(false));
    }, 450);
    return () => {
      clearTimeout(t);
      setResolving(false);
    };
  }, [address, source]);

  useEffect(() => {
    if (source === 'simulated' && mode === 'live') setMode('paper');
  }, [source, mode]);

  const start = async () => {
    await api.post('/api/session/start', {
      tokenAddress: address.trim(),
      mode,
      dataSource: source,
      startingCapitalUsd: mode === 'paper' ? capital : undefined,
      confirmPhrase: mode === 'live' ? phrase : undefined,
    });
    toast('Sesja rozpoczęta', 'ok');
  };

  return (
    <Panel title="Nowa sesja">
      <div className="col">
        <label className="field">
          <span className="field-label">Adres kontraktu tokena (Solana lub sieć EVM, np. Robinhood Chain)</span>
          <input className="mono" placeholder="adres tokena (base58 lub 0x…) albo link do tokena (pump.fun, GMGN, DexScreener)" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <div className="row">
          <div className="col" style={{ gap: 4 }}>
            <span className="field-label">Dane rynkowe</span>
            <div className="seg">
              <button className={source === 'live' ? 'on' : ''} onClick={() => setSource('live')}>Rzeczywiste</button>
              <button className={source === 'simulated' ? 'on' : ''} onClick={() => setSource('simulated')}>Symulator</button>
            </div>
          </div>
          <div className="col" style={{ gap: 4 }}>
            <span className="field-label">Tryb wykonania</span>
            <div className="seg">
              <button className={mode === 'paper' ? 'on' : ''} onClick={() => setMode('paper')}>Paper (symulacja)</button>
              <button
                className={mode === 'live' ? 'on' : ''}
                disabled={!meta.liveTradingEnabled || source !== 'live'}
                title={!meta.liveTradingEnabled ? 'Wyłączone na serwerze (LIVE_TRADING_ENABLED)' : source !== 'live' ? 'Wymaga rzeczywistych danych' : ''}
                onClick={() => setMode('live')}
              >
                Live (prawdziwe środki)
              </button>
            </div>
          </div>
          {mode === 'paper' && (
            <label className="field" style={{ width: 170 }}>
              <span className="field-label">Kapitał symulacyjny</span>
              <div className="input-unit">
                <input type="number" className="mono" step="0.1" min="0.1" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
                <span>USD</span>
              </div>
            </label>
          )}
        </div>
        {source === 'simulated' && <div className="info-box small">Symulator generuje rynek z przełączanymi reżimami (wzrost, konsolidacja, spadek…) — dowolny poprawny adres służy jako ziarno (adres 0x… = pierwsza włączona sieć EVM). Idealne do testów strategii bez sieci.</div>}
        {resolving && <div className="muted small">Wyszukiwanie tokena…</div>}
        {error && <div className="err-box">{error}</div>}
        {token && <TokenCard token={token} />}
        {mode === 'live' && (
          <div className="warn-box col">
            <b>Tryb live używa prawdziwych środków z Twojego portfela.</b>
            <span className="small">
              Transakcje są nieodwracalne.{' '}
              {token && token.chain !== 'solana'
                ? `Sieć ${chainName(token.chain)}: swap przez LI.FI z portfela EVM (waluta ${token.nativeSymbol}); sprzedaż wymaga dodatkowej transakcji approve. `
                : 'Przy kapitale rzędu 1–2 USD opłaty (prowizja platformy, opłata sieci, rent ~0,002 SOL za konto tokena) mogą pochłonąć znaczną część kapitału. '}
              Aby potwierdzić, wpisz: <code>{meta.liveConfirmPhrase}</code>
            </span>
            <input className="mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={meta.liveConfirmPhrase} />
          </div>
        )}
        <div className="row">
          <ActionButton className="btn-green btn-lg" disabled={!token || (mode === 'live' && phrase !== meta.liveConfirmPhrase)} onClick={start}>
            ▶ Start
          </ActionButton>
        </div>
      </div>
    </Panel>
  );
}

function ActiveSession() {
  const session = useStore((s) => s.session)!;
  const token = useStore((s) => s.token);
  const bot = useStore((s) => s.bot);
  const positions = useStore((s) => s.positions);
  const orders = useStore((s) => s.orders);
  const stats = useStore((s) => s.stats);
  const settings = useStore((s) => s.settings.trading);
  const now = useNow(1000);
  const sym = useNativeSymbol();
  const [buyUsd, setBuyUsd] = useState(settings.minTradeUsd);
  const [confirm, setConfirm] = useState<'stop' | 'sellAll' | null>(null);
  const [liquidate, setLiquidate] = useState(true);
  const busy = session.status === 'stopping';

  return (
    <>
      <Panel
        title="Aktywna sesja"
        actions={
          <>
            <ModeBadge mode={session.mode} />
            <SessionStatusBadge status={session.status} />
          </>
        }
      >
        <div className="grid g2">
          {token && <TokenCard token={token} />}
          <div className="col">
            <div className="stat-list" style={{ borderRadius: 8, overflow: 'hidden' }}>
              <div className="stat"><div className="stat-label">Start</div><div className="stat-value">{fmtTime(session.startedAt)}</div><div className="stat-sub">{fmtDuration((now - session.startedAt) / 1000)}</div></div>
              <div className="stat"><div className="stat-label">Kapitał początkowy</div><div className="stat-value">{fmtUsd(session.startCapitalUsd)}</div><div className="stat-sub">{fmtSol(session.startCapitalSol, false, sym)}</div></div>
              <div className="stat"><div className="stat-label">Saldo dostępne</div><div className="stat-value">{stats ? fmtUsd(stats.balance.usd) : '—'}</div><div className="stat-sub">{stats ? fmtSol(stats.balance.sol, false, sym) : ''}</div></div>
              <div className="stat"><div className="stat-label">Dane</div><div className="stat-value">{session.dataSource === 'live' ? 'rzeczywiste' : 'symulator'}</div></div>
            </div>
            <div className="row">
              {session.status === 'running' && (
                <ActionButton className="btn-amber" onClick={() => api.post('/api/session/pause')} success="Sesja wstrzymana">❚❚ Pause</ActionButton>
              )}
              {session.status === 'paused' && (
                <ActionButton className="btn-green" onClick={() => api.post('/api/session/resume')} success="Sesja wznowiona">▶ Resume</ActionButton>
              )}
              <button className="btn" disabled={busy} onClick={() => setConfirm('stop')}>■ Stop</button>
            </div>
            <div className="small muted">Pause zatrzymuje nowe decyzje strategii (twardy stop-loss może nadal działać — patrz ustawienia ryzyka). Stop kończy sesję; Emergency Stop jest zawsze dostępny na górnym pasku.</div>
          </div>
        </div>
      </Panel>

      <div className="grid g2">
        <Panel title="Maszyna stanów bota">
          <div className="col">
            <div className="states">
              {BOT_STATES.map((s) => (
                <span key={s} className={`state-node ${bot.state === s ? 'on' : ''} ${s === 'ERROR' ? 'err' : ''}`}>
                  {BOT_STATE_LABELS[s]}
                </span>
              ))}
            </div>
            <div className="small">
              <span className="muted">Sygnał: </span>
              {bot.lastSignal ?? '—'}
            </div>
            {bot.lastAction && (
              <div className="small">
                <span className="muted">Ostatnia operacja: </span>
                {bot.lastAction}
              </div>
            )}
            {bot.lastError && <div className="err-box small">{bot.lastError}</div>}
          </div>
        </Panel>
        <Panel title="Polecenia ręczne (autoryzowane)">
          <div className="col">
            <div className="row">
              <div className="input-unit" style={{ width: 160 }}>
                <input type="number" className="mono" step="0.05" min={settings.minTradeUsd} max={settings.maxTradeUsd} value={buyUsd} onChange={(e) => setBuyUsd(Number(e.target.value))} />
                <span>USD</span>
              </div>
              <ActionButton className="btn-green" disabled={busy} onClick={() => api.post('/api/commands/buy', { usd: buyUsd })} success="Zlecenie kupna w kolejce">
                Kup teraz
              </ActionButton>
              <button className="btn btn-red" disabled={busy || !positions.length} onClick={() => setConfirm('sellAll')}>
                Sprzedaj wszystko
              </button>
            </div>
            <div className="small muted">
              Polecenia przechodzą przez te same limity ryzyka co strategia (kwota {fmtUsd(settings.minTradeUsd)}–{fmtUsd(settings.maxTradeUsd)}, saldo, limit pozycji).
            </div>
          </div>
        </Panel>
      </div>

      <Panel title={`Otwarte pozycje (${positions.length})`} flush>
        <PositionsTable positions={positions} allowSell symbol={sym} />
      </Panel>

      <Panel title="Kolejka zleceń" flush>
        <DataTable
          rows={orders}
          rowKey={(o) => o.id}
          maxHeight={300}
          empty="Brak zleceń"
          columns={[
            { key: 'id', label: '#', render: (o) => <span className="mono">{o.id}</span> },
            { key: 'time', label: 'Utworzone', render: (o) => <span className="mono">{fmtTime(o.createdAt)}</span> },
            { key: 'side', label: 'Typ', render: (o) => <Badge tone={o.side === 'buy' ? 'green' : 'red'}>{o.side === 'buy' ? 'KUPNO' : 'SPRZEDAŻ'}</Badge> },
            { key: 'value', label: 'Kwota', className: 'num', render: (o) => (o.valueSol ? fmtSol(o.valueSol, false, sym) : o.positionId ? `poz. #${o.positionId}` : '—') },
            { key: 'reason', label: 'Powód', render: (o) => <span className="muted">{reasonLabel(o.reason)}</span> },
            {
              key: 'status',
              label: 'Status',
              render: (o) => (
                <Badge tone={o.status === 'filled' ? 'green' : o.status === 'failed' ? 'red' : o.status === 'cancelled' ? 'gray' : 'amber'} dot pulse={o.status === 'executing'}>
                  {o.status}
                </Badge>
              ),
            },
            { key: 'att', label: 'Próby', className: 'num', render: (o) => o.attempts },
            { key: 'err', label: 'Błąd', render: (o) => <span className="small neg">{o.error ?? ''}</span> },
          ]}
        />
      </Panel>

      {confirm === 'stop' && (
        <ConfirmModal title="Zatrzymać sesję?" confirmLabel="Zatrzymaj sesję" onConfirm={() => api.post('/api/session/stop', { liquidate })} onClose={() => setConfirm(null)}>
          <Toggle checked={liquidate} onChange={setLiquidate} label="Sprzedaj otwarte pozycje przed zakończeniem" />
          <div className="small muted">Bez sprzedaży pozycje zostaną w portfelu (w trybie paper — jako otwarte w historii sesji).</div>
        </ConfirmModal>
      )}
      {confirm === 'sellAll' && (
        <ConfirmModal title="Sprzedać wszystkie pozycje?" danger confirmLabel="Sprzedaj wszystko" onConfirm={() => api.post('/api/commands/sell-all')} onClose={() => setConfirm(null)}>
          Zlecenia sprzedaży {positions.length} pozycji trafią do kolejki natychmiast (ręczne polecenie pomija minimalny czas trzymania).
        </ConfirmModal>
      )}
    </>
  );
}

export function SessionControl() {
  const session = useStore((s) => s.session);
  return (
    <>
      <div>
        <h1 className="page-title">Session Control</h1>
        <div className="page-sub">Wybór tokena, tryb pracy i sterowanie botem.</div>
      </div>
      {session ? <ActiveSession /> : <StartForm />}
    </>
  );
}
