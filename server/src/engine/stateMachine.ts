import type { BotState } from '../../../shared/types.ts';

/** Dozwolone przejścia stanów bota. */
export const TRANSITIONS: Record<BotState, readonly BotState[]> = {
  OFFLINE: ['IDLE'],
  // IDLE → AWAITING_TASK/BUYING/SELLING: przywrócenie sesji z zaległymi zleceniami po restarcie
  IDLE: ['WATCHING', 'HOLDING', 'AWAITING_TASK', 'BUYING', 'SELLING', 'PAUSED', 'OFFLINE'],
  WATCHING: ['AWAITING_TASK', 'HOLDING', 'PAUSED', 'ERROR', 'IDLE'],
  AWAITING_TASK: ['BUYING', 'SELLING', 'WATCHING', 'HOLDING', 'PAUSED', 'ERROR', 'IDLE'],
  BUYING: ['HOLDING', 'WATCHING', 'AWAITING_TASK', 'SELLING', 'PAUSED', 'ERROR', 'IDLE'],
  HOLDING: ['AWAITING_TASK', 'WATCHING', 'PAUSED', 'ERROR', 'IDLE'],
  SELLING: ['WATCHING', 'HOLDING', 'AWAITING_TASK', 'BUYING', 'PAUSED', 'ERROR', 'IDLE'],
  PAUSED: ['WATCHING', 'HOLDING', 'AWAITING_TASK', 'BUYING', 'SELLING', 'ERROR', 'IDLE'],
  ERROR: ['WATCHING', 'HOLDING', 'AWAITING_TASK', 'BUYING', 'SELLING', 'PAUSED', 'IDLE'],
};

export class InvalidTransitionError extends Error {}

export class StateMachine {
  state: BotState = 'OFFLINE';
  previous: BotState | null = null;
  since = Date.now();
  private onChange: (from: BotState, to: BotState, reason: string) => void;

  constructor(onChange: (from: BotState, to: BotState, reason: string) => void) {
    this.onChange = onChange;
  }

  can(to: BotState): boolean {
    return to === this.state || TRANSITIONS[this.state].includes(to);
  }

  /** Przejście z walidacją; to samo miejsce docelowe jest no-op. */
  transition(to: BotState, reason: string): void {
    if (to === this.state) return;
    if (!TRANSITIONS[this.state].includes(to)) {
      throw new InvalidTransitionError(`Niedozwolone przejście ${this.state} → ${to} (${reason})`);
    }
    const from = this.state;
    this.previous = from;
    this.state = to;
    this.since = Date.now();
    this.onChange(from, to, reason);
  }
}
