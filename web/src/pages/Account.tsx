import { useEffect, useState } from 'react';
import { type AccountInfo, type WalletKind } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ActionButton, Badge, Modal, PageHeader, PageIcons, Panel } from '../components/ui.tsx';
import { fmtAgo, fmtDateTime, fmtSol } from '../format.ts';
import { toast, useStore } from '../store.ts';
import { addressUrl } from '../chains.ts';
import { ExtLink } from '../components/ExtLink.tsx';

const SECRET_LABEL: Record<string, [string, string]> = {
  wallet_private_key: ['Klucz prywatny portfela', 'Wymagany tylko w trybie live. Base58 albo tablica JSON (eksport z Phantom / solana-keygen). Zmiana na inny portfel: „Zmień portfel” powyżej.'],
  rpc_url: ['Prywatny URL RPC Solany', 'Opcjonalny (np. z kluczem API dostawcy). Bez niego używany jest publiczny RPC z pola wyżej. Zalecany w trybie live.'],
  evm_private_key: ['Klucz prywatny portfela EVM', 'Wymagany tylko w trybie live na sieciach EVM (np. Robinhood Chain). 64 znaki hex — eksport z MetaMask/Rabby. Adres EVM ustawi się sam. Zmiana na inny portfel: „Zmień portfel” powyżej.'],
  lifi_api_key: ['Klucz API LI.FI', 'Opcjonalny — wyższe limity zapytań o wyceny swapów na sieciach EVM.'],
};

/** Wiersz zaszyfrowanego sekretu (ustaw / podgląd / usuń) — używany też w Ustawieniach. */
export function SecretRow({ name, info, onChange }: { name: string; info: AccountInfo['secrets'][number]; onChange: (a: AccountInfo) => void }) {
  const [mode, setMode] = useState<'set' | 'reveal' | 'delete' | null>(null);
  const isWalletKey = name === 'wallet_private_key' || name === 'evm_private_key';
  const [value, setValue] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [label, help] = SECRET_LABEL[name] ?? [name, ''];
  const close = () => {
    setMode(null);
    setValue('');
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
                onClick={async () => {
                  onChange(await api.post<AccountInfo>(`/api/account/secrets/${name}/delete`));
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
              <div className="warn-box small">Wartość pojawi się na ekranie. Upewnij się, że nikt nie patrzy.</div>
              <ActionButton
                className="btn-primary"
                onClick={async () => setRevealed((await api.post<{ value: string }>(`/api/account/secrets/${name}/reveal`)).value)}
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

// ---------------------------------------------------------------------------
// Tabela botów: każdy bot to osobny portfel (Solana albo EVM).
// Na każdej sieci jeden bot jest aktywny (to nim handluje sesja), pozostałe czekają w rezerwie.
// ---------------------------------------------------------------------------

const NAMES_KEY = 'soldesk.botNames';

function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveName(address: string, name: string): void {
  const all = loadNames();
  if (name.trim()) all[address.toLowerCase()] = name.trim();
  else delete all[address.toLowerCase()];
  localStorage.setItem(NAMES_KEY, JSON.stringify(all));
}

const SOURCES_KEY = 'soldesk.botSources';

/** Skąd pochodzi portfel bota — pokazywane jako ikonka przy nazwie i w tabeli. */
export const BOT_SOURCES = [
  { id: 'pumpfun', label: 'Pump.fun', mono: 'P', color: '#53d769' },
  { id: 'phantom', label: 'Phantom', mono: 'Ph', color: '#ab9ff2' },
  { id: 'solflare', label: 'Solflare', mono: 'S', color: '#fc8f3b' },
  { id: 'backpack', label: 'Backpack', mono: 'B', color: '#e33e3f' },
  { id: 'gmgn', label: 'GMGN', mono: 'G', color: '#6be675' },
  { id: 'photon', label: 'Photon', mono: 'Pt', color: '#6c8cff' },
  { id: 'bullx', label: 'BullX', mono: 'Bx', color: '#f5c542' },
  { id: 'axiom', label: 'Axiom', mono: 'A', color: '#e8e8e8' },
  { id: 'trojan', label: 'Trojan', mono: 'T', color: '#3fb6f5' },
  { id: 'other', label: 'Inne', mono: '?', color: '#7f8b9c' },
] as const;
type BotSourceId = (typeof BOT_SOURCES)[number]['id'] | 'soldesk';
const APP_SOURCE = { id: 'soldesk', label: 'Utworzony w aplikacji', mono: 'SD', color: '#8b6cff' } as const;

function sourceInfo(id: string | undefined) {
  return BOT_SOURCES.find((s) => s.id === id) ?? (id === 'soldesk' ? APP_SOURCE : null);
}

function loadSources(): Record<string, BotSourceId> {
  try {
    return JSON.parse(localStorage.getItem(SOURCES_KEY) ?? '{}') as Record<string, BotSourceId>;
  } catch {
    return {};
  }
}

function saveSource(address: string, source: BotSourceId | null): void {
  const all = loadSources();
  if (source) all[address.toLowerCase()] = source;
  else delete all[address.toLowerCase()];
  localStorage.setItem(SOURCES_KEY, JSON.stringify(all));
}

/** Mała ikonka źródła (monogram w kolorze platformy). */
function SourceIcon({ id, size = 18 }: { id: string | undefined; size?: number }) {
  const s = sourceInfo(id);
  if (!s) return null;
  return (
    <span className="src-ico" title={s.label} style={{ width: size, height: size, fontSize: size * 0.48, color: s.color, borderColor: s.color, background: `${s.color}22` }}>
      {s.mono}
    </span>
  );
}

/** Siatka wyboru źródła portfela (import istniejącego bota / edycja). */
function SourcePicker({ value, onChange }: { value: BotSourceId | null; onChange: (v: BotSourceId) => void }) {
  return (
    <div className="src-grid" role="radiogroup" aria-label="Skąd jest ten portfel">
      {BOT_SOURCES.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={value === s.id} className={`src-opt${value === s.id ? ' on' : ''}`} onClick={() => onChange(s.id)}>
          <SourceIcon id={s.id} size={22} />
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

interface BotRow {
  key: string;
  kind: WalletKind;
  address: string;
  active: boolean;
  /** id w archiwum — tylko dla botów w rezerwie */
  archiveId: number | null;
  since: number | null;
}

function buildRows(account: AccountInfo): BotRow[] {
  const rows: BotRow[] = [];
  // aplikacja działa na Solanie — portfele EVM nie są pokazywane
  for (const kind of ['solana'] as WalletKind[]) {
    const secret = account.secrets.find((s) => s.name === (kind === 'solana' ? 'wallet_private_key' : 'evm_private_key'));
    const address = kind === 'solana' ? account.walletAddress : account.evmWalletAddress;
    if (secret?.isSet && address) rows.push({ key: `${kind}:active`, kind, address, active: true, archiveId: null, since: secret.updatedAt });
    for (const a of account.archivedWallets.filter((w) => w.kind === kind)) {
      rows.push({ key: `${kind}:${a.id}`, kind, address: a.address, active: false, archiveId: a.id, since: a.archivedAt });
    }
  }
  return rows;
}

function NewBotModal({ account, onDone, onClose }: { account: AccountInfo; onDone: (a: AccountInfo) => void; onClose: () => void }) {
  const kind: WalletKind = 'solana';
  const [source, setSource] = useState<'generate' | 'import'>('generate');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState<BotSourceId | null>(null);
  const hasActive = buildRows(account).some((r) => r.kind === kind && r.active);
  const ready = source === 'generate' || (!!key.trim() && !!origin);

  const create = async () => {
    let created: { account: AccountInfo; address: string };
    if (source === 'generate' && !hasActive) {
      created = await api.post<{ account: AccountInfo; address: string }>('/api/account/generate-wallet', { kind });
    } else {
      created = await api.post<{ account: AccountInfo; address: string }>('/api/account/change-wallet', {
        kind,
        source,
        ...(source === 'import' ? { privateKey: key } : {}),
      });
    }
    // bez podanej nazwy: kolejny numer (Bot 1, Bot 2…), zapamiętany na stałe dla tego portfela
    saveName(created.address, name.trim() || `Bot ${Object.keys(loadNames()).length + 1}`);
    saveSource(created.address, source === 'import' ? origin : 'soldesk');
    onDone(created.account);
    onClose();
    toast(`Dodano bota: ${loadNames()[created.address.toLowerCase()] ?? shortAddr(created.address)}`, 'ok', 7000);
  };

  return (
    <Modal
      title="Nowy bot"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Anuluj
          </button>
          <ActionButton className="btn-primary" disabled={!ready} onClick={create}>
            + Dodaj bota
          </ActionButton>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nazwa (opcjonalnie)</span>
        <input autoFocus placeholder="np. Bot główny" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="col" style={{ gap: 6 }}>
        <span className="field-label">Portfel</span>
        <div className="seg">
          <button className={source === 'generate' ? 'on' : ''} onClick={() => setSource('generate')}>
            Utwórz nowy
          </button>
          <button className={source === 'import' ? 'on' : ''} onClick={() => setSource('import')}>
            Mam własny klucz
          </button>
        </div>
      </div>
      {source === 'generate' ? (
        <div className="small muted">Aplikacja utworzy nowy portfel Solana i od razu zaszyfruje jego klucz. Dostaniesz adres, na który przelewasz SOL dla tego bota.</div>
      ) : (
        <>
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label">Skąd jest ten portfel?</span>
            <SourcePicker value={origin} onChange={setOrigin} />
          </div>
          <textarea
            className="mono"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder="Klucz prywatny Solana: base58 albo tablica JSON (eksport z Phantoma)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="small faint">Nigdy nie wklejaj frazy odzyskiwania (12/24 słowa) — tylko klucz prywatny portfela.</div>
        </>
      )}
      {hasActive && (
        <div className="info-box small">
          Nowy bot od razu stanie się <b>aktywny</b>. Obecny aktywny bot przejdzie do rezerwy — jego klucz zostaje, możesz do niego wrócić jednym kliknięciem.
        </div>
      )}
    </Modal>
  );
}

function BotsTable({ account, onChange, onRefresh }: { account: AccountInfo; onChange: (a: AccountInfo) => void; onRefresh: () => Promise<unknown> }) {
  const wallet = useStore((st) => st.wallet);
  const evmChain = useStore((st) => st.settings.evm.chains.find((c) => c.enabled) ?? null);
  const liveActive = useStore((st) => st.session?.mode === 'live');
  const [names, setNames] = useState(loadNames);
  const [sources, setSources] = useState(loadSources);
  const [editSource, setEditSource] = useState<BotSourceId | null>(null);
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<{ row: BotRow; type: 'key' | 'delete' | 'rename' } | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const rows = buildRows(account);

  const chainKey = (kind: WalletKind) => (kind === 'solana' ? 'solana' : (wallet.evm?.chain ?? evmChain?.key ?? 'robinhood'));
  const symbol = (kind: WalletKind) => (kind === 'solana' ? 'SOL' : (wallet.evm?.nativeSymbol ?? evmChain?.nativeSymbol ?? 'ETH'));
  const balance = (r: BotRow): number | null => {
    if (!r.active) return null;
    if (r.kind === 'solana') return wallet.address === r.address ? wallet.solBalance : null;
    return wallet.evm?.address?.toLowerCase() === r.address.toLowerCase() ? wallet.evm.nativeBalance : null;
  };
  const nameOf = (r: BotRow) => names[r.address.toLowerCase()] ?? `Bot ${r.address.slice(0, 4)}`;
  const close = () => {
    setAction(null);
    setRevealed(null);
  };

  const activate = async (r: BotRow) => {
    const res = await api.post<{ account: AccountInfo; address: string }>('/api/account/change-wallet', { kind: r.kind, source: 'archive', archiveId: r.archiveId });
    onChange(res.account);
    toast('Bot jest teraz aktywny', 'ok');
  };

  return (
    <Panel
      title={`Boty (${rows.length})`}
      flush
      actions={
        <>
          <ActionButton className="btn-icon" onClick={onRefresh} title="Odśwież listę botów i salda">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 5.7" />
              <path d="M20 4v7h-7" />
            </svg>
            <span className="sr-only">Odśwież</span>
          </ActionButton>
          <button className="btn btn-primary" disabled={liveActive} onClick={() => setAdding(true)} title={liveActive ? 'Najpierw zakończ sesję live' : 'Utwórz albo zaimportuj portfel nowego bota'}>
          + Nowy bot
          </button>
        </>
      }
    >
      {rows.length ? (
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="bots-table">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Źródło</th>
                <th>Adres portfela (Solana)</th>
                <th className="num">Saldo</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.active ? 'bot-active' : ''}>
                  <td>
                    <div className="bot-name">
                      <span className="bot-avatar">
                        {nameOf(r).slice(0, 1).toUpperCase()}
                        {sources[r.address.toLowerCase()] && (
                          <span className="bot-avatar-src">
                            <SourceIcon id={sources[r.address.toLowerCase()]} size={16} />
                          </span>
                        )}
                      </span>
                      <span>
                        <b>{nameOf(r)}</b>
                        <button className="link-edit" title="Zmień nazwę i źródło" onClick={() => (setRename(names[r.address.toLowerCase()] ?? ''), setEditSource(sources[r.address.toLowerCase()] ?? null), setAction({ row: r, type: 'rename' }))}>
                          ✎
                        </button>
                        <div className="small faint">{r.active ? 'od' : 'w rezerwie od'} {fmtDateTime(r.since)}</div>
                      </span>
                    </div>
                  </td>
                  <td>
                    {sourceInfo(sources[r.address.toLowerCase()]) ? (
                      <span className="src-cell">
                        <SourceIcon id={sources[r.address.toLowerCase()]} size={20} />
                        {sourceInfo(sources[r.address.toLowerCase()])!.label}
                      </span>
                    ) : (
                      <button className="link-edit small" onClick={() => (setRename(names[r.address.toLowerCase()] ?? ''), setEditSource(null), setAction({ row: r, type: 'rename' }))}>
                        + ustaw
                      </button>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <ExtLink className="mono" href={addressUrl(chainKey(r.kind), r.address, 'address')} title={r.address}>
                        {shortAddr(r.address)}
                      </ExtLink>
                      <button className="btn btn-ghost btn-sm" title="Kopiuj adres" onClick={() => void navigator.clipboard.writeText(r.address).then(() => toast('Skopiowano adres', 'ok'))}>
                        Kopiuj
                      </button>
                    </div>
                  </td>
                  <td className="num">{r.active ? fmtSol(balance(r), false, symbol(r.kind)) : <span className="faint">—</span>}</td>
                  <td>
                    {r.active ? (
                      <Badge tone="green" dot>
                        Aktywny
                      </Badge>
                    ) : (
                      <Badge tone="gray">W rezerwie</Badge>
                    )}
                  </td>
                  <td className="right">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {!r.active && (
                        <ActionButton className="btn-sm btn-primary" disabled={liveActive} onClick={() => activate(r)} title={liveActive ? 'Najpierw zakończ sesję live' : 'Ustaw tego bota jako aktywnego'}>
                          Ustaw jako aktywny
                        </ActionButton>
                      )}
                      <button className="btn btn-sm" onClick={() => setAction({ row: r, type: 'key' })}>
                        Klucz
                      </button>
                      <button className="btn btn-sm btn-ghost" disabled={r.active && liveActive} onClick={() => setAction({ row: r, type: 'delete' })}>
                        Usuń
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bots-empty">
          <div className="bots-empty-title">Nie masz jeszcze żadnego bota</div>
          <div className="muted">Bot to osobny portfel, którym aplikacja handluje w trybie live. Utwórz pierwszego — zajmie to kilka sekund.</div>
          <button className="btn btn-primary btn-lg" onClick={() => setAdding(true)}>
            + Utwórz pierwszego bota
          </button>
        </div>
      )}
      <div className="bots-note small muted">
        Na każdej sieci <b>handluje aktywny bot</b>. Boty w rezerwie mają zachowane klucze — możesz do nich wrócić w dowolnej chwili. Zrób kopię klucza każdego bota (przycisk
        „Klucz”), zanim przelejesz na niego środki.
      </div>

      {adding && <NewBotModal account={account} onDone={onChange} onClose={() => setAdding(false)} />}

      {action?.type === 'rename' && (
        <Modal
          title="Edytuj bota"
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>
                Anuluj
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  saveName(action.row.address, rename);
                  if (editSource) saveSource(action.row.address, editSource);
                  setNames(loadNames());
                  setSources(loadSources());
                  close();
                }}
              >
                Zapisz
              </button>
            </>
          }
        >
          <label className="field">
            <span className="field-label">Nazwa</span>
            <input autoFocus value={rename} placeholder="np. Bot główny" onChange={(e) => setRename(e.target.value)} />
          </label>
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label">Skąd jest ten portfel</span>
            {editSource === 'soldesk' ? (
              <span className="src-cell">
                <SourceIcon id="soldesk" size={20} /> {APP_SOURCE.label}
              </span>
            ) : (
              <SourcePicker value={editSource} onChange={setEditSource} />
            )}
          </div>
          <div className="small faint">Nazwa i źródło są zapisywane w tej przeglądarce.</div>
        </Modal>
      )}

      {action?.type === 'key' && (
        <Modal title={`Klucz bota ${shortAddr(action.row.address)}`} onClose={close}>
          {revealed === null ? (
            <>
              <div className="small muted">Klucz przyda się do importu w Phantomie / MetaMasku (kopia zapasowa, wypłata środków). Upewnij się, że nikt nie patrzy na ekran.</div>
              <ActionButton
                className="btn-primary"
                onClick={async () => {
                  const r = action.row;
                  const url = r.active ? `/api/account/secrets/${r.kind === 'solana' ? 'wallet_private_key' : 'evm_private_key'}/reveal` : `/api/account/wallet-archive/${r.archiveId}/reveal`;
                  setRevealed((await api.post<{ value: string }>(url)).value);
                }}
              >
                Pokaż klucz
              </ActionButton>
            </>
          ) : (
            <>
              <textarea className="mono" rows={3} readOnly value={revealed} />
              <div className="warn-text small">Nie udostępniaj tego klucza nikomu. Zamknij okno po użyciu.</div>
            </>
          )}
        </Modal>
      )}

      {action?.type === 'delete' && (
        <Modal
          title={`Usuń bota ${shortAddr(action.row.address)}`}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>
                Anuluj
              </button>
              <ActionButton
                className="btn-red"
                onClick={async () => {
                  const r = action.row;
                  const url = r.active ? `/api/account/secrets/${r.kind === 'solana' ? 'wallet_private_key' : 'evm_private_key'}/delete` : `/api/account/wallet-archive/${r.archiveId}/delete`;
                  onChange(await api.post<AccountInfo>(url));
                  close();
                }}
                success="Bot usunięty"
              >
                Usuń trwale
              </ActionButton>
            </>
          }
        >
          <div className="warn-box small">
            Aplikacja usunie klucz tego portfela. Jeśli są na nim środki, a nie masz własnej kopii klucza, <b>stracisz do nich dostęp</b>. Najpierw wypłać środki albo zapisz klucz
            (przycisk „Klucz”).
          </div>
        </Modal>
      )}
    </Panel>
  );
}

export function Account() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  useEffect(() => {
    void api.get<AccountInfo>('/api/account').then(setAccount).catch(() => undefined);
  }, []);

  if (!account) return <div className="muted">Ładowanie…</div>;
  return (
    <div className="big-ui">
      <PageHeader icon={PageIcons.user} title="Konta" desc="Twoje boty — każdy to osobny portfel Solana." />

      <BotsTable
        account={account}
        onChange={setAccount}
        onRefresh={async () => {
          await api.post('/api/wallet/refresh').catch(() => undefined);
          setAccount(await api.get<AccountInfo>('/api/account'));
        }}
      />

    </div>
  );
}
