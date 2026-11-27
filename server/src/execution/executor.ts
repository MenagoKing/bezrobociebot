import type { ExecutionMode, Order, Position, SessionRecord, TokenInfo } from '../../../shared/types.ts';

/** Wynik wykonania zlecenia (rzeczywisty lub symulowany). */
export interface Fill {
  amount: number; // liczba tokenów (UI)
  decimals: number;
  /** kupno: SOL wydane na swap (z prowizją platformy); sprzedaż: SOL otrzymane (po prowizji platformy) */
  valueSol: number;
  feeSol: number; // prowizja platformy, jeśli znana osobno
  networkFeeSol: number; // opłata sieci + priorytet
  rentSol: number; // rent za utworzenie konta tokena (tylko kupno)
  priceSol: number; // cena efektywna
  marketPriceSol: number; // cena rynkowa w chwili wykonania
  txSignature: string | null;
}

export interface ExecContext {
  session: SessionRecord;
  token: TokenInfo;
  /** Portfel, z którego wykonywane jest zlecenie (0 = główny portfel bota). */
  walletId: number;
  /** Pierwszy zakup tokena z tego portfela w sesji (Solana: tworzy konto tokena → rent). */
  firstBuyOnWallet: boolean;
}

export interface ExecHooks {
  onSubmitted(signature: string): void;
}

export interface Executor {
  readonly mode: ExecutionMode;
  buy(ctx: ExecContext, valueSol: number, hooks: ExecHooks): Promise<Fill>;
  sell(ctx: ExecContext, position: Position, isLastPosition: boolean, hooks: ExecHooks): Promise<Fill>;
  /** Uzgodnienie zlecenia przerwanego restartem; null = nie wykonało się. */
  reconcile(ctx: ExecContext, order: Order): Promise<Fill | null>;
}

/** Błąd o niepewnym wyniku (transakcja wysłana, brak potwierdzenia) — nie ponawiamy automatycznie. */
export class UncertainExecutionError extends Error {}
