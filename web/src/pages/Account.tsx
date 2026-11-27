import { useEffect, useState } from 'react';
import { PLATFORMS, type AccountInfo, type AccountProfile, type ArchivedWallet, type TradingWallet, type WalletKind } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ActionButton, Badge, Modal, Panel } from '../components/ui.tsx';
import { fmtAgo, fmtDateTime, fmtSol, fmtUsd, fmtCompact } from '../format.ts';
import { toast, useStore } from '../store.ts';
import { addressUrl, chainName } from '../chains.ts';

const PLATFORM_LABEL: Record<string, string> = { pumpfun: 'Pump.fun', gmgn: 'GMGN', fomo: 'FOMO', other: 'Inna' };
const SECRET_LABEL: Record<string, [string, string]> = {
  wallet_private_key: ['Klucz prywatny portfela', 'Wymagany tylko w trybie live. Klucz prywatny (87–88 znaków base58 albo tablica JSON — eksport z pump.fun / Phantoma / solana-keygen), nie adres portfela. Zmiana na inny portfel: „Zmień portfel” powyżej.'],
  rpc_url: ['Prywatny URL RPC Solany', 'Opcjonalny (np. z kluczem API dostawcy). Bez niego używany jest publiczny RPC z ustawień systemu.'],
  evm_private_key: ['Klucz prywatny portfela EVM', 'Wymagany tylko w trybie live na sieciach EVM (np. Robinhood Chain). 64 znaki hex — eksport z MetaMask/Rabby. Adres EVM ustawi się sam. Zmiana na inny portfel: „Zmień portfel” powyżej.'],
  lifi_api_key: ['Klucz API LI.FI', 'Opcjonalny — wyższe limity zapytań o wyceny swapów na sieciach EVM.'],
};

interface CheckResult {
  walletValid: boolean;
  keySet: boolean;
  keyMatches: boolean | null;
  balanceSol: number | null;
  rpcOk: boolean;
  error: string | null;
}

function SecretRow({ name, info, onChange }: { name: string; info: AccountInfo['secrets'][number]; onChange: (a: AccountInfo) => void }) {
  const [mode, setMode] = useState<'set' | 'reveal' | 'delete' | null>(null);
  const isWalletKey = name === 'wallet_private_key' || name === 'evm_private_key';
  const [value, setValue] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [label, help] = SECRET_LABEL[name] ?? [name, ''];
  const close = () => {
    setMode(null);
    setValue('');
    setPassword('');
    setRevealed(null);
  };
  return (
    <div className="spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="small faint">{help}</div>
      </div>
      <div className="row">
        {info.isSet ? <Badge tone="green" dot>zaszyfrowany · {fmtAgo(info.updatedAt)}</Badge> : <Badge tone="gray">nie ustawiony</Badge>}
        {!(isWalletKey && info.isSet) && <button className="btn btn-sm" onClick={() => setMode('set')}>{info.isSet ? 'Zmień' : 'Ustaw'}</button>}
        {info.isSet && <button className="btn btn-sm" onClick={() => setMode('reveal')}>Podgląd</button>}
        {info.isSet && (
          <button className="btn btn-sm btn-ghost" onClick={() => setMode('delete')}>
            Usuń
          </button>
        )}
      </div>
      {mode === 'set' && (
        <Modal
          title={`${info.isSet ? 'Zmień' : 'Ustaw'}: ${label}`}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>Anuluj</button>
              <ActionButton
                className="btn-primary"
                disabled={!value.trim()}
                onClick={async () => {
                  onChange(await api.put<AccountInfo>(`/api/account/secrets/${name}`, { value }));
                  close();
                }}
                success="Zapisano (zaszyfrowane)"
              >
                Zapisz
              </ActionButton>
            </>
          }
        >
          <textarea className="mono" rows={3} autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="small muted">Wartość jest szyfrowana AES-256-GCM kluczem głównym serwera i nigdy nie trafia do logów.</div>
        </Modal>
      )}
      {mode === 'delete' && (
        <Modal
          title={`Usuń: ${label}`}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>Anuluj</button>
              <ActionButton
                className="btn-red"
                disabled={isWalletKey && !password}
                onClick={async () => {
                  onChange(await api.post<AccountInfo>(`/api/account/secrets/${name}/delete`, isWalletKey ? { password } : {}));
                  close();
                }}
                success="Usunięto"
              >
                Usuń trwale
              </ActionButton>
            </>
          }
        >
          {isWalletKey ? (
            <>
              <div className="warn-box small">
                Jeśli ten portfel został wygenerowany w aplikacji i nie masz kopii klucza, po usunięciu stracisz dostęp do środków na nim.
                Najpierw wypłać środki albo zrób kopię klucza (Podgląd → import do Phantoma).
              </div>
              <input type="password" placeholder="Hasło administratora" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          ) : (
            <div className="small muted">Sekret zostanie usunięty z bazy.</div>
          )}
        </Modal>
      )}
      {mode === 'reveal' && (
        <Modal title={`Podgląd: ${label}`} onClose={close}>
          {revealed === null ? (
            <>
              <div className="small muted">Podaj hasło administratora, aby wyświetlić sekret.</div>
              <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <ActionButton
                className="btn-primary"
                disabled={!password}
                onClick={async () => setRevealed((await api.post<{ value: string }>(`/api/account/secrets/${name}/reveal`, { password })).value)}
              >
                Pokaż
              </ActionButton>
            </>
          ) : (
            <>
              <textarea className="mono" rows={3} readOnly value={revealed} />
              <div className="warn-text small">Nie udostępniaj tej wartości nikomu. Zamknij okno po użyciu.</div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

type ChangeSource = 'generate' | 'import' | 'archive';

function ChangeWalletModal(props: {
  kind: WalletKind;
  title: string;
  current: string;
  symbol: string;
  balance: number | null;
  tokenBalance: number | null;
  archived: ArchivedWallet[];
  preset: number | null;
  onDone: (a: AccountInfo) => void;
  onClose: () => void;
}) {
  const { kind, archived } = props;
  const [source, setSource] = useState<ChangeSource>(props.preset !== null ? 'archive' : 'generate');
  const [archiveId, setArchiveId] = useState<number | null>(props.preset ?? archived[0]?.id ?? null);
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const ready = !!password && (source === 'generate' || (source === 'import' && !!key.trim()) || (source === 'archive' && archiveId !== null));
  const hasFunds = (props.balance ?? 0) > 0 || (props.tokenBalance ?? 0) > 0;
  return (
    <Modal
      title={`Zmień portfel bota — ${props.title}`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Anuluj</button>
          <ActionButton
            className="btn-primary"
            disabled={!ready}
            onClick={async () => {
              const r = await api.post<{ account: AccountInfo; address: string; previousAddress: string | null }>('/api/account/change-wallet', {
                kind,
                source,
                password,
                ...(source === 'import' ? { privateKey: key } : {}),
                ...(source === 'archive' && archiveId !== null ? { archiveId } : {}),
              });
              props.onDone(r.account);
              props.onClose();
              toast(`Nowy portfel bota: ${r.address}${r.previousAddress ? ` (poprzedni ${shortAddr(r.previousAddress)} w archiwum)` : ''}`, 'ok', 9000);
            }}
          >
            Zmień portfel
          </ActionButton>
        </>
      }
    >
      {props.current && (
        <div className="small muted">
          Obecny: <code className="mono">{props.current}</code>
        </div>
      )}
      <div className="seg">
        <button className={source === 'generate' ? 'on' : ''} onClick={() => setSource('generate')}>Nowy portfel</button>
        <button className={source === 'import' ? 'on' : ''} onClick={() => setSource('import')}>Importuj klucz</button>
        <button className={source === 'archive' ? 'on' : ''} disabled={archived.length === 0} onClick={() => setSource('archive')}>
          Z archiwum{archived.length ? ` (${archived.length})` : ''}
        </button>
      </div>
      {source === 'generate' && <div className="small muted">Aplikacja utworzy nowy klucz lokalnie i od razu go zaszyfruje. Dostaniesz nowy adres do zasilenia.</div>}
      {source === 'import' && (
        <>
          <textarea
            className="mono"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              kind === 'solana'
                ? 'Klucz PRYWATNY Solana (87–88 znaków base58 albo tablica JSON) — nie adres portfela'
                : 'Klucz PRYWATNY EVM: 64 znaki hex (z 0x lub bez) — nie adres 0x…'
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="small faint">
            {kind === 'solana'
              ? 'Na pump.fun: ustawienia konta → eksport klucza prywatnego (Export private key). Adres portfela (32–44 znaki) nie zadziała. '
              : ''}
            Klucz wpisujesz tylko tutaj, w swoim panelu — jest szyfrowany na serwerze i nie trafia do logów. Nigdy nie wklejaj frazy odzyskiwania.
            Po zmianie porównaj nowy adres bota z adresem pokazywanym na pump.fun.
          </div>
        </>
      )}
      {source === 'archive' && (
        <select value={archiveId ?? ''} onChange={(e) => setArchiveId(Number(e.target.value))}>
          {archived.map((a) => (
            <option key={a.id} value={a.id}>
              {shortAddr(a.address)} · zarchiwizowany {fmtDateTime(a.archivedAt)}
            </option>
          ))}
        </select>
      )}
      {props.current && hasFunds && (
        <div className="warn-box small">
          Na obecnym portfelu są środki ({fmtSol(props.balance, false, props.symbol)}
          {(props.tokenBalance ?? 0) > 0 ? ` i ${fmtCompact(props.tokenBalance)} tokena sesji` : ''}). Zostają na starym adresie — bot przestanie go używać.
          Wypłać je przed zmianą albo później: Poprzednie portfele → Klucz → import do Phantoma.
        </div>
      )}
      {props.current && (
        <div className="info-box small">Obecny klucz nie zostanie usunięty: trafi do „Poprzednie portfele” (dalej zaszyfrowany). Możesz do niego wrócić albo podejrzeć klucz.</div>
      )}
      <input type="password" placeholder="Hasło administratora" value={password} onChange={(e) => setPassword(e.target.value)} />
    </Modal>
  );
}

function ArchivedWallets(props: { list: ArchivedWallet[]; chainKey: string; canRestore: boolean; onRestore: (id: number) => void; onChange: (a: AccountInfo) => void }) {
  const [target, setTarget] = useState<{ wallet: ArchivedWallet; action: 'reveal' | 'delete' } | null>(null);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const close = () => {
    setTarget(null);
    setPassword('');
    setRevealed(null);
  };
  if (props.list.length === 0) return null;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="field-label">Poprzednie portfele ({props.list.length})</div>
      {props.list.map((a) => (
        <div key={a.id} className="col small" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div>
            <a className="mono" href={addressUrl(props.chainKey, a.address, 'address')} target="_blank" rel="noreferrer" title={a.address}>
              {shortAddr(a.address)} ↗
            </a>
            <span className="faint"> · {fmtDateTime(a.archivedAt)}</span>
          </div>
          <div className="row">
            <button className="btn btn-sm" disabled={!props.canRestore} title={props.canRestore ? 'Ustaw ten portfel jako portfel bota' : 'Najpierw zakończ sesję live'} onClick={() => props.onRestore(a.id)}>
              Przywróć
            </button>
            <button className="btn btn-sm" onClick={() => setTarget({ wallet: a, action: 'reveal' })}>Klucz</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setTarget({ wallet: a, action: 'delete' })}>Usuń</button>
          </div>
        </div>
      ))}
      {target?.action === 'reveal' && (
        <Modal title={`Klucz poprzedniego portfela ${shortAddr(target.wallet.address)}`} onClose={close}>
          {revealed === null ? (
            <>
              <div className="small muted">Podaj hasło administratora, aby wyświetlić klucz (np. do importu w Phantomie i wypłaty środków).</div>
              <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <ActionButton
                className="btn-primary"
                disabled={!password}
                onClick={async () => setRevealed((await api.post<{ value: string }>(`/api/account/wallet-archive/${target.wallet.id}/reveal`, { password })).value)}
              >
                Pokaż
              </ActionButton>
            </>
          ) : (
            <>
              <textarea className="mono" rows={3} readOnly value={revealed} />
              <div className="warn-text small">Nie udostępniaj tej wartości nikomu. Zamknij okno po użyciu.</div>
            </>
          )}
        </Modal>
      )}
      {target?.action === 'delete' && (
        <Modal
          title={`Usuń z archiwum: ${shortAddr(target.wallet.address)}`}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>Anuluj</button>
              <ActionButton
                className="btn-red"
                disabled={!password}
                onClick={async () => {
                  props.onChange(await api.post<AccountInfo>(`/api/account/wallet-archive/${target.wallet.id}/delete`, { password }));
                  close();
                }}
                success="Usunięto z archiwum"
              >
                Usuń trwale
              </ActionButton>
            </>
          }
        >
          <div className="warn-box small">
            Po usunięciu aplikacja nie będzie już miała klucza do tego adresu. Jeśli są na nim środki i nie masz własnej kopii klucza, stracisz do nich dostęp.
            Sprawdź saldo w eksploratorze przed usunięciem.
          </div>
          <input type="password" placeholder="Hasło administratora" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}

function BotWalletCard({ kind, account, onChange }: { kind: WalletKind; account: AccountInfo; onChange: (a: AccountInfo) => void }) {
  const wallet = useStore((st) => st.wallet);
  const evmChain = useStore((st) => st.settings.evm.chains.find((c) => c.enabled) ?? null);
  const liveActive = useStore((st) => st.session?.mode === 'live');
  const [confirm, setConfirm] = useState(false);
  const [change, setChange] = useState<{ preset: number | null } | null>(null);
  const archived = account.archivedWallets.filter((a) => a.kind === kind);
  const isSol = kind === 'solana';
  const secret = account.secrets.find((x) => x.name === (isSol ? 'wallet_private_key' : 'evm_private_key'));
  const address = isSol ? account.walletAddress : account.evmWalletAddress;
  const chainKey = isSol ? 'solana' : (wallet.evm?.chain ?? evmChain?.key ?? 'robinhood');
  const title = isSol ? 'Solana' : `EVM — ${chainName(chainKey)}${evmChain ? ' i inne sieci EVM' : ''}`;
  const symbol = isSol ? 'SOL' : (wallet.evm?.nativeSymbol ?? evmChain?.nativeSymbol ?? 'ETH');
  const balance = isSol ? (wallet.address === address ? wallet.solBalance : null) : wallet.evm?.address?.toLowerCase() === address.toLowerCase() ? wallet.evm.nativeBalance : null;
  const hasKey = !!secret?.isSet && !!address;

  return (
    <div className="panel" style={{ background: 'var(--bg-2)' }}>
      <div className="panel-head">
        <div className="panel-title">{title}</div>
        {hasKey ? <Badge tone="green" dot>gotowy</Badge> : <Badge tone="gray">brak portfela</Badge>}
      </div>
      <div className="panel-body col">
        {hasKey ? (
          <>
            <div className="field-label">Adres do zasilenia ({symbol}{isSol ? '' : ` na ${chainName(chainKey)}`})</div>
            <div className="row">
              <code className="mono" style={{ wordBreak: 'break-all', fontSize: 12.5 }}>{address}</code>
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(address).then(() => toast('Skopiowano adres', 'ok'))}>
                Kopiuj
              </button>
            </div>
            <div className="row small">
              <span className="muted">Saldo:</span>
              <span className="mono">{fmtSol(balance, false, symbol)}</span>
              <a href={addressUrl(chainKey, address, 'address')} target="_blank" rel="noreferrer">eksplorator ↗</a>
            </div>
            <div className="small faint">
              Kopia zapasowa: klucz jest tylko w tej aplikacji (zaszyfrowany). Zrób kopię przed zasileniem: Dane dostępowe → Podgląd (hasło) →
              w Phantomie Add Account → Import Private Key, albo zapisz w menedżerze haseł.
            </div>
            <div className="row">
              <button className="btn btn-sm" disabled={liveActive} onClick={() => setChange({ preset: null })}>
                Zmień portfel
              </button>
              {liveActive && <span className="small faint">Zmiana możliwa po zakończeniu sesji live.</span>}
            </div>
          </>
        ) : (
          <>
            <div className="small muted">
              Aplikacja utworzy nowy portfel: klucz powstaje lokalnie i od razu jest szyfrowany, Ty dostajesz tylko adres. Zasilasz go zwykłym przelewem
              {isSol ? ' SOL z Phantoma.' : ` ${symbol} na ${chainName(chainKey)}.`}
            </div>
            {address && <div className="warn-text small">Ustawiony jest adres bez klucza ({address.slice(0, 6)}…) — nowy portfel go zastąpi.</div>}
            <div className="row">
              <button className="btn btn-primary" disabled={liveActive} onClick={() => setConfirm(true)}>
                Wygeneruj portfel bota
              </button>
              <button className="btn" disabled={liveActive} onClick={() => setChange({ preset: null })}>
                Importuj / przywróć
              </button>
            </div>
          </>
        )}
        <ArchivedWallets list={archived} chainKey={chainKey} canRestore={!liveActive} onRestore={(id) => setChange({ preset: id })} onChange={onChange} />
      </div>
      {change && (
        <ChangeWalletModal
          kind={kind}
          title={title}
          current={hasKey ? address : ''}
          symbol={symbol}
          balance={balance}
          tokenBalance={isSol ? (wallet.address === address ? wallet.tokenBalance : null) : (wallet.evm?.tokenBalance ?? null)}
          archived={archived}
          preset={change.preset}
          onDone={onChange}
          onClose={() => setChange(null)}
        />
      )}
      {confirm && (
        <Modal
          title={`Nowy portfel bota — ${title}`}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>Anuluj</button>
              <ActionButton
                className="btn-primary"
                onClick={async () => {
                  const r = await api.post<{ account: AccountInfo; address: string }>('/api/account/generate-wallet', { kind });
                  onChange(r.account);
                  setConfirm(false);
                  toast(`Utworzono portfel bota: ${r.address}`, 'ok', 8000);
                }}
              >
                Wygeneruj
              </ActionButton>
            </>
          }
        >
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Portfel będzie używany przez bota w trybie live.</li>
            <li>Przelej na niego tylko kwotę przeznaczoną do testów.</li>
            <li>Zrób kopię klucza (Podgląd → import do Phantoma) — bez kopii utrata danych aplikacji oznacza utratę środków.</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}

function TradingWallets({ account, onChange }: { account: AccountInfo; onChange: (a: AccountInfo) => void }) {
  const wallet = useStore((st) => st.wallet);
  const perWallet = useStore((st) => st.settings.trading.maxPositionsPerWallet);
  const maxOpen = useStore((st) => st.settings.trading.maxOpenPositions);
  const liveActive = useStore((st) => st.session?.mode === 'live');
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<WalletKind>('solana');
  const [source, setSource] = useState<'generate' | 'import'>('generate');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [target, setTarget] = useState<{ wallet: TradingWallet; action: 'reveal' | 'delete' | 'rename' } | null>(null);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const closeAdd = () => {
    setAdding(false);
    setLabel('');
    setKey('');
  };
  const close = () => {
    setTarget(null);
    setPassword('');
    setRevealed(null);
  };
  const list = account.tradingWallets;
  const lockTitle = liveActive ? 'Najpierw zakończ sesję live' : undefined;
  const mainCount = (account.walletAddress ? 1 : 0) + (account.evmWalletAddress ? 1 : 0);

  return (
    <Panel
      title={`Portfele handlowe (dodatkowe: ${list.length})`}
      actions={
        <button className="btn btn-sm btn-primary" disabled={liveActive} title={lockTitle} onClick={() => setAdding(true)}>
          Dodaj portfel
        </button>
      }
    >
      <div className="col">
        <div className="small muted">
          Bot otwiera pozycje z portfela głównego i z włączonych portfeli poniżej (tej samej sieci co token sesji). Limit
          <b> „Maks. pozycji na jeden portfel”</b> (Trading Config) ustawia, ile pozycji naraz może mieć jeden portfel — przy 1 każda pozycja idzie z
          osobnego portfela, a sprzedaż zawsze z portfela, który pozycję otworzył.
        </div>
        <div className={perWallet === 1 ? 'info-box small' : 'warn-box small'}>
          Obecnie: {perWallet === 0 ? 'bez limitu pozycji na portfel (kilka pozycji może trafić na jeden portfel)' : `maks. ${perWallet} poz. na portfel`} · maks.
          otwartych pozycji łącznie: {maxOpen}. Przy limicie 1 liczba równoległych pozycji = liczba portfeli danej sieci (główny + włączone dodatkowe).
        </div>
        {list.length === 0 && <div className="small faint">Brak dodatkowych portfeli{mainCount ? ' — bot używa tylko portfela głównego' : ''}.</div>}
        {list.map((w) => {
          const info = wallet.extra.find((x) => x.id === w.id);
          const chainKey = info?.chain || (w.kind === 'solana' ? 'solana' : 'robinhood');
          return (
            <div key={w.id} className="spread" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div className="col" style={{ gap: 4 }}>
                <div className="row">
                  <b>{w.label || `Portfel #${w.id}`}</b>
                  <Badge tone="gray">{w.kind === 'solana' ? 'Solana' : 'EVM'}</Badge>
                  {w.enabled ? <Badge tone="green" dot>w użyciu</Badge> : <Badge tone="gray">wyłączony</Badge>}
                </div>
                <div className="row small">
                  <code className="mono" title={w.address}>{shortAddr(w.address)}</code>
                  <button className="btn btn-sm btn-ghost" onClick={() => void navigator.clipboard.writeText(w.address).then(() => toast('Skopiowano adres', 'ok'))}>
                    Kopiuj
                  </button>
                  <a href={addressUrl(chainKey, w.address, 'address')} target="_blank" rel="noreferrer">eksplorator ↗</a>
                  <span className="muted">Saldo:</span>
                  <span className="mono">{fmtSol(info?.nativeBalance ?? null, false, info?.nativeSymbol ?? (w.kind === 'solana' ? 'SOL' : 'ETH'))}</span>
                  {info?.tokenBalance ? <span className="mono">· {fmtCompact(info.tokenBalance)} tokena</span> : null}
                </div>
                {info?.error && <div className="err-box small">{info.error}</div>}
              </div>
              <div className="row">
                <ActionButton
                  className="btn-sm"
                  disabled={liveActive}
                  onClick={async () => onChange(await api.post<AccountInfo>(`/api/account/trading-wallets/${w.id}`, { enabled: !w.enabled }))}
                >
                  {w.enabled ? 'Wyłącz' : 'Włącz'}
                </ActionButton>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setRename(w.label);
                    setTarget({ wallet: w, action: 'rename' });
                  }}
                >
                  Nazwa
                </button>
                <button className="btn btn-sm" onClick={() => setTarget({ wallet: w, action: 'reveal' })}>Klucz</button>
                <button className="btn btn-sm btn-ghost" disabled={liveActive} title={lockTitle} onClick={() => setTarget({ wallet: w, action: 'delete' })}>
                  Usuń
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {adding && (
        <Modal
          title="Dodaj portfel handlowy"
          onClose={closeAdd}
          footer={
            <>
              <button className="btn" onClick={closeAdd}>Anuluj</button>
              <ActionButton
                className="btn-primary"
                disabled={source === 'import' && !key.trim()}
                onClick={async () => {
                  const r = await api.post<{ account: AccountInfo; wallet: TradingWallet }>('/api/account/trading-wallets', {
                    kind,
                    source,
                    label,
                    ...(source === 'import' ? { privateKey: key } : {}),
                  });
                  onChange(r.account);
                  closeAdd();
                  toast(`Dodano portfel ${r.wallet.address} — zasil go, zanim bot z niego kupi`, 'ok', 9000);
                }}
              >
                Dodaj
              </ActionButton>
            </>
          }
        >
          <div className="seg">
            <button className={kind === 'solana' ? 'on' : ''} onClick={() => setKind('solana')}>Solana</button>
            <button className={kind === 'evm' ? 'on' : ''} onClick={() => setKind('evm')}>EVM</button>
          </div>
          <div className="seg">
            <button className={source === 'generate' ? 'on' : ''} onClick={() => setSource('generate')}>Nowy portfel</button>
            <button className={source === 'import' ? 'on' : ''} onClick={() => setSource('import')}>Importuj klucz</button>
          </div>
          <input placeholder="Nazwa (opcjonalnie, np. Portfel 2)" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
          {source === 'generate' ? (
            <div className="small muted">Klucz powstaje lokalnie i od razu jest szyfrowany. Dostaniesz adres do zasilenia — zrób kopię klucza (Klucz → hasło).</div>
          ) : (
            <>
              <textarea
                className="mono"
                rows={3}
                autoComplete="off"
                spellCheck={false}
                placeholder={kind === 'solana' ? 'Klucz PRYWATNY Solana (base58 albo tablica JSON) — nie adres' : 'Klucz PRYWATNY EVM: 64 znaki hex — nie adres 0x…'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <div className="small faint">Klucz jest szyfrowany na serwerze i nie trafia do logów. Nigdy nie wklejaj frazy odzyskiwania.</div>
            </>
          )}
        </Modal>
      )}
      {target?.action === 'rename' && (
        <Modal
          title={`Nazwa portfela ${shortAddr(target.wallet.address)}`}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>Anuluj</button>
              <ActionButton
                className="btn-primary"
                onClick={async () => {
                  onChange(await api.post<AccountInfo>(`/api/account/trading-wallets/${target.wallet.id}`, { label: rename }));
                  close();
                }}
              >
                Zapisz
              </ActionButton>
            </>
          }
        >
          <input autoFocus maxLength={40} value={rename} onChange={(e) => setRename(e.target.value)} />
        </Modal>
      )}
      {target?.action === 'reveal' && (
        <Modal title={`Klucz portfela ${target.wallet.label || shortAddr(target.wallet.address)}`} onClose={close}>
          {revealed === null ? (
            <>
              <div className="small muted">Podaj hasło administratora, aby wyświetlić klucz (kopia zapasowa, import w Phantomie/MetaMasku).</div>
              <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <ActionButton
                className="btn-primary"
                disabled={!password}
                onClick={async () => setRevealed((await api.post<{ value: string }>(`/api/account/trading-wallets/${target.wallet.id}/reveal`, { password })).value)}
              >
                Pokaż
              </ActionButton>
            </>
          ) : (
            <>
              <textarea className="mono" rows={3} readOnly value={revealed} />
              <div className="warn-text small">Nie udostępniaj tej wartości nikomu. Zamknij okno po użyciu.</div>
            </>
          )}
        </Modal>
      )}
      {target?.action === 'delete' && (
        <Modal
          title={`Usuń portfel handlowy ${target.wallet.label || shortAddr(target.wallet.address)}`}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>Anuluj</button>
              <ActionButton
                className="btn-red"
                disabled={!password}
                onClick={async () => {
                  onChange(await api.post<AccountInfo>(`/api/account/trading-wallets/${target.wallet.id}/delete`, { password }));
                  close();
                }}
                success="Portfel przeniesiony do archiwum"
              >
                Usuń z listy
              </ActionButton>
            </>
          }
        >
          <div className="info-box small">
            Bot przestanie używać tego portfela. Klucz nie zostanie skasowany — trafi do „Poprzednie portfele” (zaszyfrowany), więc dostęp do środków zostaje.
            Portfela z otwartą pozycją w aktywnej sesji nie można usunąć.
          </div>
          <input type="password" placeholder="Hasło administratora" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Modal>
      )}
    </Panel>
  );
}

export function Account() {
  const wallet = useStore((s) => s.wallet);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [draft, setDraft] = useState<AccountProfile | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });

  const apply = (a: AccountInfo) => {
    setAccount(a);
    setDraft({ name: a.name, email: a.email, platform: a.platform, walletAddress: a.walletAddress, evmWalletAddress: a.evmWalletAddress });
  };
  useEffect(() => {
    void api.get<AccountInfo>('/api/account').then(apply).catch(() => undefined);
  }, []);

  if (!account || !draft) return <div className="muted">Ładowanie…</div>;
  return (
    <>
      <div>
        <h1 className="page-title">Konto i portfel</h1>
        <div className="page-sub">Twoje dane, adresy portfeli (Solana i EVM) oraz zaszyfrowane dane dostępowe.</div>
      </div>
      <Panel title="Portfel bota">
        <div className="grid g2">
          <BotWalletCard kind="solana" account={account} onChange={apply} />
          <BotWalletCard kind="evm" account={account} onChange={apply} />
        </div>
      </Panel>
      <TradingWallets account={account} onChange={apply} />
      <div className="grid g2">
        <Panel title="Profil" actions={<ActionButton className="btn-primary btn-sm" onClick={async () => apply(await api.put<AccountInfo>('/api/account', draft))} success="Zapisano profil">Zapisz</ActionButton>}>
          <div className="form-grid">
            <label className="field"><span className="field-label">Nazwa</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="field"><span className="field-label">E-mail</span><input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
            <label className="field">
              <span className="field-label">Główna platforma</span>
              <select value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value as AccountInfo['platform'] })}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </select>
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span className="field-label">Adres portfela Solana (publiczny)</span>
              <input className="mono" value={draft.walletAddress} onChange={(e) => setDraft({ ...draft, walletAddress: e.target.value.trim() })} placeholder="ustawiany automatycznie po dodaniu klucza" />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span className="field-label">Adres portfela EVM (publiczny, 0x…)</span>
              <input className="mono" value={draft.evmWalletAddress} onChange={(e) => setDraft({ ...draft, evmWalletAddress: e.target.value.trim() })} placeholder="ustawiany automatycznie po dodaniu klucza EVM" />
            </label>
          </div>
        </Panel>
        <Panel
          title="Portfel"
          actions={
            <>
              <ActionButton className="btn-sm" onClick={() => api.post('/api/wallet/refresh')}>Odśwież</ActionButton>
              <ActionButton className="btn-sm btn-primary" onClick={async () => setCheck(await api.post<CheckResult>('/api/account/check'))}>Sprawdź konto</ActionButton>
            </>
          }
        >
          <div className="col">
            <div className="stat-list" style={{ borderRadius: 8, overflow: 'hidden' }}>
              <div className="stat"><div className="stat-label">Saldo SOL</div><div className="stat-value">{fmtSol(wallet.solBalance)}</div><div className="stat-sub">{wallet.solBalance !== null ? fmtUsd(wallet.solBalance * wallet.solUsd) : ''}</div></div>
              <div className="stat"><div className="stat-label">Token sesji</div><div className="stat-value">{wallet.tokenBalance !== null ? fmtCompact(wallet.tokenBalance) : '—'}</div></div>
              <div className="stat"><div className="stat-label">Aktualizacja</div><div className="stat-value small">{fmtDateTime(wallet.updatedAt)}</div></div>
            </div>
            {wallet.error && <div className="err-box small">{wallet.error}</div>}
            {wallet.evm && (
              <>
                <div className="field-label">Portfel EVM — {chainName(wallet.evm.chain)}</div>
                <div className="stat-list" style={{ borderRadius: 8, overflow: 'hidden' }}>
                  <div className="stat">
                    <div className="stat-label">Saldo {wallet.evm.nativeSymbol}</div>
                    <div className="stat-value">{fmtSol(wallet.evm.nativeBalance, false, wallet.evm.nativeSymbol)}</div>
                    <div className="stat-sub">{wallet.evm.nativeBalance !== null ? fmtUsd(wallet.evm.nativeBalance * wallet.evm.nativeUsd) : ''}</div>
                  </div>
                  <div className="stat"><div className="stat-label">Token sesji</div><div className="stat-value">{wallet.evm.tokenBalance !== null ? fmtCompact(wallet.evm.tokenBalance) : '—'}</div></div>
                </div>
                {wallet.evm.error && <div className="err-box small">{wallet.evm.error}</div>}
                <a className="small" href={addressUrl(wallet.evm.chain, wallet.evm.address, 'address')} target="_blank" rel="noreferrer">Portfel EVM w eksploratorze ↗</a>
              </>
            )}
            {wallet.address && (
              <a className="small" href={`https://solscan.io/account/${wallet.address}`} target="_blank" rel="noreferrer">Portfel w Solscan ↗</a>
            )}
            {check && (
              <div className={check.error ? 'warn-box small' : 'info-box small'}>
                Adres: {check.walletValid ? 'poprawny' : 'brak/niepoprawny'} · klucz: {check.keySet ? (check.keyMatches ? 'zgodny z adresem' : 'NIEZGODNY') : 'nie ustawiony'} · RPC: {check.rpcOk ? 'OK' : 'błąd'}
                {check.balanceSol !== null && ` · saldo ${fmtSol(check.balanceSol)}`}
                {check.error && <div>{check.error}</div>}
              </div>
            )}
          </div>
        </Panel>
      </div>
      <Panel title="Dane dostępowe (zaszyfrowane)">
        {account.secrets.map((s) => (
          <SecretRow key={s.name} name={s.name} info={s} onChange={apply} />
        ))}
        <div className="small muted mt">Sekrety są szyfrowane kluczem głównym (MASTER_KEY lub data/master.key), który nie jest zapisany w bazie. Podgląd wymaga ponownego podania hasła i jest odnotowywany w logu (bez wartości).</div>
      </Panel>
      <Panel title="Hasło administratora">
        <div className="row">
          <input type="password" placeholder="Obecne hasło" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input type="password" placeholder="Nowe hasło (min. 10 znaków)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <input type="password" placeholder="Powtórz nowe hasło" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
          <ActionButton
            className="btn-primary"
            disabled={!pw.current || pw.next.length < 10 || pw.next !== pw.repeat}
            onClick={async () => {
              await api.post('/api/auth/change-password', { current: pw.current, next: pw.next });
              setPw({ current: '', next: '', repeat: '' });
              toast('Hasło zmienione — inne sesje zostały wylogowane', 'ok');
            }}
          >
            Zmień hasło
          </ActionButton>
        </div>
      </Panel>
    </>
  );
}
