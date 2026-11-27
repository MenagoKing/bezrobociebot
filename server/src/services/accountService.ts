import { z } from 'zod';
import { MAIN_WALLET_ID, PLATFORMS, type AccountInfo, type TradingWallet, type WalletKind } from '../../../shared/types.ts';
import type { SettingsService } from '../config/settingsService.ts';
import { formatZodError } from '../config/schema.ts';
import type { ErrorMonitor } from '../core/errorMonitor.ts';
import { logger } from '../core/logger.ts';
import { UserError, errorMessage } from '../core/util.ts';
import type { Repository } from '../db/repository.ts';
import { isEvmAddress, isValidSolanaAddress } from '../market/provider.ts';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Vault } from '../security/vault.ts';
import { base58Encode } from '../solana/base58.ts';
import { generateSolanaSecret, keypairFromSecret, parseSecretKey, type SolanaKeypair } from '../solana/keypair.ts';
import type { SolanaRpc } from '../solana/rpc.ts';

export const SECRET_NAMES = ['wallet_private_key', 'rpc_url', 'evm_private_key', 'lifi_api_key'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export const WALLET_SECRETS: string[] = ['wallet_private_key', 'evm_private_key'];
const WALLET_SECRET: Record<WalletKind, SecretName> = { solana: 'wallet_private_key', evm: 'evm_private_key' };
const CHANGE_HINT = 'Aby zmienić portfel bota, użyj „Zmień portfel” w sekcji Portfel bota (stary klucz trafi do archiwum).';

export type WalletChangeSource = 'generate' | 'import' | 'archive';

/** Portfel, z którego bot może handlować: główny (id 0) albo dodatkowy. */
export interface WalletSlot {
  id: number;
  kind: WalletKind;
  label: string;
  address: string;
}

const sameAddress = (kind: WalletKind, a: string, b: string) => (kind === 'evm' ? a.toLowerCase() === b.toLowerCase() : a === b);

const accountSchema = z.object({
  name: z.string().max(80),
  email: z.union([z.literal(''), z.string().email('Nieprawidłowy e-mail')]),
  platform: z.enum(PLATFORMS),
  walletAddress: z.string().refine((v) => v === '' || isValidSolanaAddress(v), 'Nieprawidłowy adres portfela Solana'),
  evmWalletAddress: z.string().refine((v) => v === '' || isEvmAddress(v), 'Nieprawidłowy adres portfela EVM (0x…)'),
});

/** Klucz EVM: 32 bajty hex, z prefiksem 0x lub bez. */
export function parseEvmPrivateKey(input: string): `0x${string}` {
  const v = input.trim();
  const hex = v.startsWith('0x') || v.startsWith('0X') ? v.slice(2) : v;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Klucz EVM musi mieć 64 znaki hex (z prefiksem 0x lub bez)');
  return `0x${hex.toLowerCase()}`;
}

/**
 * Konto właściciela: profil, adres portfela i zaszyfrowane sekrety (klucz portfela, prywatny URL RPC).
 * Sekrety nigdy nie trafiają do logów ani odpowiedzi API — wyjątkiem jest jawny podgląd na żądanie z panelu.
 */
export class AccountService {
  private keypairCache: SolanaKeypair | null = null;
  private evmCache: PrivateKeyAccount | null = null;
  private slotKeypairs = new Map<number, SolanaKeypair>();
  private slotEvm = new Map<number, PrivateKeyAccount>();
  private repo: Repository;
  private vault: Vault;
  private settings: SettingsService;
  private errors: ErrorMonitor;

  constructor(repo: Repository, vault: Vault, settings: SettingsService, errors: ErrorMonitor) {
    this.repo = repo;
    this.vault = vault;
    this.settings = settings;
    this.errors = errors;
  }

  get(): AccountInfo {
    const meta = new Map(this.repo.listSecretMeta().map((s) => [s.name, s.updatedAt]));
    return {
      ...this.repo.getAccount(),
      secrets: SECRET_NAMES.map((name) => ({ name, isSet: meta.has(name), updatedAt: meta.get(name) ?? null })),
      archivedWallets: this.repo.listArchivedWallets(),
      tradingWallets: this.repo.listTradingWallets(),
    };
  }

  // ---------- dodatkowe portfele handlowe ----------

  /**
   * Portfele, z których bot może otwierać pozycje na danej sieci: główny (jeśli jest) + włączone dodatkowe.
   * W trybie paper główny portfel jest zawsze dostępny (symulacja nie potrzebuje klucza).
   */
  walletSlots(kind: WalletKind, opts: { requireKey: boolean }): WalletSlot[] {
    const profile = this.repo.getAccount();
    const mainAddress = kind === 'solana' ? profile.walletAddress : profile.evmWalletAddress;
    const slots: WalletSlot[] = [];
    if (!opts.requireKey || (this.repo.getSecret(WALLET_SECRET[kind]) && mainAddress)) {
      slots.push({ id: MAIN_WALLET_ID, kind, label: 'główny', address: mainAddress });
    }
    for (const w of this.repo.listTradingWallets(kind)) {
      if (w.enabled) slots.push({ id: w.id, kind, label: w.label || `portfel #${w.id}`, address: w.address });
    }
    return slots;
  }

  /** Adres portfela o danym id (0 = główny) albo null. */
  walletAddress(kind: WalletKind, walletId: number): string | null {
    if (walletId === MAIN_WALLET_ID) {
      const p = this.repo.getAccount();
      return (kind === 'solana' ? p.walletAddress : p.evmWalletAddress) || null;
    }
    const w = this.repo.getTradingWallet(walletId);
    return w && w.kind === kind ? w.address : null;
  }

  private assertNotTradingWallet(kind: WalletKind, address: string): void {
    if (this.repo.findTradingWalletByAddress(kind, address)) {
      throw new UserError('Ten portfel jest już na liście dodatkowych portfeli handlowych — najpierw go stamtąd usuń');
    }
  }

  /** Dodanie portfela handlowego: nowy wygenerowany w aplikacji albo import klucza. */
  addTradingWallet(input: { kind: WalletKind; source: 'generate' | 'import'; privateKey?: string; label?: string }): { account: AccountInfo; wallet: TradingWallet } {
    const { kind } = input;
    let next: { stored: string; address: string };
    if (input.source === 'generate') next = this.newKey(kind);
    else {
      if (!input.privateKey?.trim()) throw new UserError('Podaj klucz prywatny portfela');
      next = this.parseKey(kind, input.privateKey);
    }
    const profile = this.repo.getAccount();
    const mainAddress = kind === 'solana' ? profile.walletAddress : profile.evmWalletAddress;
    if (mainAddress && sameAddress(kind, mainAddress, next.address)) throw new UserError('To jest główny portfel bota — nie trzeba go dodawać');
    this.assertNotTradingWallet(kind, next.address);
    const label = (input.label ?? '').trim().slice(0, 40);
    const wallet = this.repo.tx(() => {
      this.repo.deleteArchivedWalletByAddress(kind, next.address); // klucz z archiwum wraca do użytku
      return this.repo.createTradingWallet({ kind, label, address: next.address, ciphertext: this.vault.encrypt(next.stored, WALLET_SECRET[kind]) });
    });
    logger.info({ kind, id: wallet.id, address: wallet.address, source: input.source }, 'dodano portfel handlowy');
    return { account: this.get(), wallet };
  }

  updateTradingWallet(id: number, patch: { label?: string; enabled?: boolean }): AccountInfo {
    if (!this.repo.getTradingWallet(id)) throw new UserError('Nie ma takiego portfela', 404);
    this.repo.updateTradingWallet(id, { label: patch.label?.trim().slice(0, 40), enabled: patch.enabled });
    return this.get();
  }

  /** Klucz portfela handlowego (np. do importu w Phantomie i wypłaty środków). */
  async revealTradingWallet(id: number): Promise<string> {
    const w = this.repo.getTradingWallet(id);
    const blob = this.repo.getTradingWalletCiphertext(id);
    if (!w || !blob) throw new UserError('Nie ma takiego portfela', 404);
    logger.warn({ kind: w.kind, address: w.address }, 'podgląd klucza portfela handlowego');
    return this.vault.decrypt(blob, WALLET_SECRET[w.kind]);
  }

  /** Usunięcie portfela z listy handlowej — klucz nie znika, tylko trafia do archiwum (dalej zaszyfrowany). */
  async removeTradingWallet(id: number): Promise<AccountInfo> {
    const w = this.repo.getTradingWallet(id);
    const blob = this.repo.getTradingWalletCiphertext(id);
    if (!w || !blob) throw new UserError('Nie ma takiego portfela', 404);
    if (this.repo.countOpenPositionsOnWallet(id) > 0) throw new UserError('Portfel ma otwartą pozycję w aktywnej sesji — najpierw ją zamknij', 409);
    this.repo.tx(() => {
      this.repo.archiveWallet(w.kind, w.address, blob);
      this.repo.deleteTradingWallet(id);
    });
    if (w.kind === 'solana') this.slotKeypairs.delete(id);
    else this.slotEvm.delete(id);
    logger.info({ kind: w.kind, id, address: w.address }, 'usunięto portfel handlowy (klucz w archiwum)');
    return this.get();
  }

  private slotSecret(walletId: number, kind: WalletKind): string {
    const w = this.repo.getTradingWallet(walletId);
    const blob = this.repo.getTradingWalletCiphertext(walletId);
    if (!w || !blob || w.kind !== kind) throw new UserError(`Brak portfela handlowego #${walletId} (${kind === 'solana' ? 'Solana' : 'EVM'})`);
    return this.vault.decrypt(blob, WALLET_SECRET[kind]);
  }

  update(input: unknown): AccountInfo {
    const parsed = accountSchema.safeParse({ ...this.repo.getAccount(), ...(input as object) });
    if (!parsed.success) throw new UserError(formatZodError(parsed.error));
    const key = this.tryKeypair();
    if (key && parsed.data.walletAddress && key.address !== parsed.data.walletAddress) {
      throw new UserError(`Adres portfela Solana nie pasuje do zapisanego klucza. ${CHANGE_HINT}`);
    }
    const evm = this.tryEvmAccount();
    if (evm && parsed.data.evmWalletAddress && evm.address.toLowerCase() !== parsed.data.evmWalletAddress.toLowerCase()) {
      throw new UserError(`Adres portfela EVM nie pasuje do zapisanego klucza. ${CHANGE_HINT}`);
    }
    this.repo.saveAccount(parsed.data);
    return this.get();
  }

  setSecret(name: string, value: string): AccountInfo {
    if (!SECRET_NAMES.includes(name as SecretName)) throw new UserError('Nieznany sekret');
    const v = value.trim();
    if (!v) throw new UserError('Wartość nie może być pusta');
    if (name === 'wallet_private_key') {
      let kp: SolanaKeypair;
      try {
        kp = keypairFromSecret(parseSecretKey(v));
      } catch (err) {
        throw new UserError(`Nieprawidłowy klucz prywatny: ${errorMessage(err)}`);
      }
      const account = this.repo.getAccount();
      if (account.walletAddress && account.walletAddress !== kp.address) {
        throw new UserError(`Ten klucz należy do innego portfela niż obecny. ${CHANGE_HINT}`);
      }
      this.assertNotTradingWallet('solana', kp.address);
      if (!account.walletAddress) this.repo.saveAccount({ ...account, walletAddress: kp.address });
      this.keypairCache = null;
    }
    if (name === 'rpc_url' && !/^https?:\/\//.test(v)) throw new UserError('URL RPC musi zaczynać się od http(s)://');
    let stored = v;
    if (name === 'evm_private_key') {
      let acc: PrivateKeyAccount;
      try {
        stored = parseEvmPrivateKey(v);
        acc = privateKeyToAccount(stored as `0x${string}`);
      } catch (err) {
        throw new UserError(`Nieprawidłowy klucz EVM: ${errorMessage(err)}`);
      }
      const account = this.repo.getAccount();
      if (account.evmWalletAddress && account.evmWalletAddress.toLowerCase() !== acc.address.toLowerCase()) {
        throw new UserError(`Ten klucz należy do innego portfela EVM niż obecny. ${CHANGE_HINT}`);
      }
      this.assertNotTradingWallet('evm', acc.address);
      this.repo.saveAccount({ ...account, evmWalletAddress: acc.address });
      this.evmCache = null;
    }
    this.repo.setSecret(name, this.vault.encrypt(stored, name));
    logger.info({ secret: name }, 'zapisano sekret (zaszyfrowany)');
    return this.get();
  }

  /**
   * Usunięcie sekretu. Uwaga: jeśli portfel został wygenerowany w aplikacji, to może być jedyna kopia klucza
   * (utrata dostępu do środków) — panel ostrzega o tym przed usunięciem.
   */
  async deleteSecret(name: string): Promise<AccountInfo> {
    if (!SECRET_NAMES.includes(name as SecretName)) throw new UserError('Nieznany sekret');
    this.repo.deleteSecret(name);
    if (name === 'wallet_private_key') this.keypairCache = null;
    if (name === 'evm_private_key') this.evmCache = null;
    logger.info({ secret: name }, 'usunięto sekret');
    return this.get();
  }

  /**
   * Tworzy nowy portfel bota w aplikacji: klucz powstaje lokalnie, jest od razu szyfrowany, a na zewnątrz
   * trafia tylko adres publiczny (do zasilenia przelewem). Nie nadpisuje istniejącego klucza.
   */
  generateWallet(kind: WalletKind): { account: AccountInfo; address: string } {
    if (this.repo.getSecret(WALLET_SECRET[kind])) throw new UserError(`Portfel bota dla tej sieci już istnieje. ${CHANGE_HINT}`, 409);
    const next = this.newKey(kind);
    this.repo.tx(() => this.storeWalletKey(kind, next));
    logger.info({ kind, address: next.address }, 'wygenerowano nowy portfel bota');
    return { account: this.get(), address: next.address };
  }

  /**
   * Zmiana portfela bota: nowy wygenerowany, import własnego klucza albo powrót do portfela z archiwum.
   * Obecny klucz nie jest usuwany — trafia do archiwum (nadal zaszyfrowany), więc dostęp do ewentualnych środków zostaje.
   */
  async changeWallet(
    input: { kind: WalletKind; source: WalletChangeSource; privateKey?: string; archiveId?: number },
  ): Promise<{ account: AccountInfo; address: string; previousAddress: string | null }> {
    const { kind } = input;
    const secretName = WALLET_SECRET[kind];
    let next: { stored: string; address: string };
    if (input.source === 'generate') next = this.newKey(kind);
    else if (input.source === 'import') {
      if (!input.privateKey?.trim()) throw new UserError('Podaj klucz prywatny portfela');
      next = this.parseKey(kind, input.privateKey);
    } else {
      const archived = input.archiveId !== undefined ? this.repo.getArchivedWallet(input.archiveId) : null;
      if (!archived || archived.kind !== kind) throw new UserError('Nie ma takiego portfela w archiwum', 404);
      next = this.parseKey(kind, this.vault.decrypt(archived.ciphertext, secretName));
    }

    const currentBlob = this.repo.getSecret(secretName);
    const profile = this.repo.getAccount();
    const profileAddress = (kind === 'solana' ? profile.walletAddress : profile.evmWalletAddress) || null;
    const keyAddress = kind === 'solana' ? this.tryKeypair()?.address : this.tryEvmAccount()?.address;
    const currentAddress = currentBlob ? (keyAddress ?? profileAddress) : null;
    if (currentAddress && sameAddress(kind, currentAddress, next.address)) throw new UserError('To jest obecny portfel bota — nic nie zmieniono');
    this.assertNotTradingWallet(kind, next.address);

    this.repo.tx(() => {
      this.repo.deleteArchivedWalletByAddress(kind, next.address); // portfel wraca z archiwum (albo jego klucz wklejono ponownie)
      if (currentBlob) this.repo.archiveWallet(kind, currentAddress ?? '(nieznany adres)', currentBlob);
      this.storeWalletKey(kind, next);
    });
    logger.info({ kind, source: input.source, address: next.address, previous: currentAddress }, 'zmieniono portfel bota (poprzedni klucz w archiwum)');
    return { account: this.get(), address: next.address, previousAddress: currentAddress };
  }

  /** Podgląd klucza portfela z archiwum (np. do importu w Phantomie i wypłaty środków). */
  async revealArchived(id: number): Promise<string> {
    const archived = this.repo.getArchivedWallet(id);
    if (!archived) throw new UserError('Nie ma takiego portfela w archiwum', 404);
    logger.warn({ kind: archived.kind, address: archived.address }, 'podgląd klucza z archiwum');
    return this.vault.decrypt(archived.ciphertext, WALLET_SECRET[archived.kind]);
  }

  /** Trwałe usunięcie klucza z archiwum — potem dostęp do środków na tym adresie jest tylko z własnej kopii klucza. */
  async deleteArchived(id: number): Promise<AccountInfo> {
    const archived = this.repo.getArchivedWallet(id);
    if (!archived) throw new UserError('Nie ma takiego portfela w archiwum', 404);
    this.repo.deleteArchivedWallet(id);
    logger.warn({ kind: archived.kind, address: archived.address }, 'usunięto klucz portfela z archiwum');
    return this.get();
  }

  private newKey(kind: WalletKind): { stored: string; address: string } {
    if (kind === 'solana') {
      const secret = generateSolanaSecret();
      const result = { stored: base58Encode(secret), address: keypairFromSecret(secret).address };
      secret.fill(0);
      return result;
    }
    const key = generatePrivateKey();
    return { stored: key, address: privateKeyToAccount(key).address };
  }

  private parseKey(kind: WalletKind, raw: string): { stored: string; address: string } {
    const v = raw.trim();
    try {
      if (kind === 'solana') return { stored: v, address: keypairFromSecret(parseSecretKey(v)).address };
      const key = parseEvmPrivateKey(v);
      return { stored: key, address: privateKeyToAccount(key).address };
    } catch (err) {
      throw new UserError(`Nieprawidłowy klucz ${kind === 'solana' ? 'Solana' : 'EVM'}: ${errorMessage(err)}`);
    }
  }

  /** Zapis klucza w sejfie i adresu w profilu (wywoływać w transakcji). */
  private storeWalletKey(kind: WalletKind, key: { stored: string; address: string }): void {
    const secretName = WALLET_SECRET[kind];
    const profile = this.repo.getAccount();
    this.repo.setSecret(secretName, this.vault.encrypt(key.stored, secretName));
    this.repo.saveAccount(kind === 'solana' ? { ...profile, walletAddress: key.address } : { ...profile, evmWalletAddress: key.address });
    if (kind === 'solana') this.keypairCache = null;
    else this.evmCache = null;
  }

  /** Podgląd sekretu na żądanie z panelu (odnotowywany w logu, bez wartości). */
  async reveal(name: string): Promise<string> {
    const blob = this.repo.getSecret(name);
    if (!blob) throw new UserError('Sekret nie jest ustawiony', 404);
    logger.warn({ secret: name }, 'podgląd sekretu');
    return this.vault.decrypt(blob, name);
  }

  private tryKeypair(): SolanaKeypair | null {
    try {
      return this.repo.getSecret('wallet_private_key') ? this.getKeypair() : null;
    } catch {
      return null;
    }
  }

  /** Para kluczy Solany portfela o danym id (0 = główny portfel bota). */
  getKeypair(walletId: number = MAIN_WALLET_ID): SolanaKeypair {
    if (walletId !== MAIN_WALLET_ID) {
      const hit = this.slotKeypairs.get(walletId);
      if (hit) return hit;
      const kp = keypairFromSecret(parseSecretKey(this.slotSecret(walletId, 'solana')));
      this.slotKeypairs.set(walletId, kp);
      return kp;
    }
    if (this.keypairCache) return this.keypairCache;
    const blob = this.repo.getSecret('wallet_private_key');
    if (!blob) throw new UserError('Brak klucza prywatnego portfela (ustaw go w zakładce Konta)');
    this.keypairCache = keypairFromSecret(parseSecretKey(this.vault.decrypt(blob, 'wallet_private_key')));
    return this.keypairCache;
  }

  private tryEvmAccount(): PrivateKeyAccount | null {
    try {
      return this.repo.getSecret('evm_private_key') ? this.getEvmAccount() : null;
    } catch {
      return null;
    }
  }

  /** Konto EVM portfela o danym id (0 = główny portfel bota). */
  getEvmAccount(walletId: number = MAIN_WALLET_ID): PrivateKeyAccount {
    if (walletId !== MAIN_WALLET_ID) {
      const hit = this.slotEvm.get(walletId);
      if (hit) return hit;
      const acc = privateKeyToAccount(parseEvmPrivateKey(this.slotSecret(walletId, 'evm')));
      this.slotEvm.set(walletId, acc);
      return acc;
    }
    if (this.evmCache) return this.evmCache;
    const blob = this.repo.getSecret('evm_private_key');
    if (!blob) throw new UserError('Brak klucza portfela EVM (ustaw go w zakładce Konta)');
    this.evmCache = privateKeyToAccount(parseEvmPrivateKey(this.vault.decrypt(blob, 'evm_private_key')));
    return this.evmCache;
  }

  hasEvmKey(): boolean {
    return !!this.repo.getSecret('evm_private_key');
  }

  lifiApiKey(): string | null {
    const blob = this.repo.getSecret('lifi_api_key');
    if (!blob) return null;
    try {
      return this.vault.decrypt(blob, 'lifi_api_key');
    } catch (err) {
      this.errors.record('account.lifi', err, { throttleMs: 600_000 });
      return null;
    }
  }

  hasKeypair(): boolean {
    return !!this.repo.getSecret('wallet_private_key');
  }

  rpcUrl(): string {
    const blob = this.repo.getSecret('rpc_url');
    if (blob) {
      try {
        return this.vault.decrypt(blob, 'rpc_url');
      } catch (err) {
        this.errors.record('account.rpc', err, { throttleMs: 600_000 });
      }
    }
    return this.settings.get().system.rpcUrl;
  }

  /** Sprawdzenie konta: poprawność adresu, zgodność klucza, saldo przez RPC. */
  async checkStatus(rpc: SolanaRpc): Promise<{ walletValid: boolean; keySet: boolean; keyMatches: boolean | null; balanceSol: number | null; rpcOk: boolean; error: string | null }> {
    const account = this.repo.getAccount();
    const walletValid = isValidSolanaAddress(account.walletAddress);
    const keySet = this.hasKeypair();
    let keyMatches: boolean | null = null;
    if (keySet) {
      try {
        keyMatches = this.getKeypair().address === account.walletAddress;
      } catch {
        keyMatches = false;
      }
    }
    if (!walletValid) return { walletValid, keySet, keyMatches, balanceSol: null, rpcOk: false, error: 'Brak poprawnego adresu portfela' };
    try {
      const lamports = await rpc.getBalanceLamports(account.walletAddress);
      return { walletValid, keySet, keyMatches, balanceSol: lamports / 1e9, rpcOk: true, error: null };
    } catch (err) {
      return { walletValid, keySet, keyMatches, balanceSol: null, rpcOk: false, error: errorMessage(err) };
    }
  }
}
