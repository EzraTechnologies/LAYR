import { errorMessage, RpcError, RpcUnconfirmedError } from '../moonraker/client';
import type { PrinterState } from '../printer/model';
import type { PrinterConnection } from '../printer/source';
import { EMPTY_COMMAND_CONTEXT, ESTOP_GROUP, prepareCommand, type CommandContext, type Confirmation, type PrinterCommand } from './commands';

export type CommandOutcome =
  | { status: 'ok'; summary: string; note: string | null }
  /** The command needs an explicit confirmation; call `execute` again with `{ confirmed: true }`. */
  | { status: 'needs_confirmation'; confirm: Confirmation }
  /** Not allowed in the current state; nothing was sent. */
  | { status: 'blocked'; message: string }
  /** A command in the same group is still running; nothing was sent. */
  | { status: 'busy'; message: string }
  /** Moonraker or Klipper rejected the command. */
  | { status: 'failed'; summary: string; message: string }
  /** The request was sent but no reply arrived (timeout or disconnect). It may or may not have run. */
  | { status: 'unconfirmed'; summary: string; message: string };

export type Availability = { allowed: true; note: string | null } | { allowed: false; message: string };

export interface GatewayOptions {
  /** How long a command stays busy waiting for its `settled` condition after success. */
  settleTimeoutMs?: number;
  settlePollMs?: number;
  /** Spoolman and other facts that are not part of `PrinterState`. */
  context?: () => CommandContext;
}

/**
 * The only path from the UI to printer-changing Moonraker methods. Every call re-validates the command against
 * the latest state, enforces confirmation, and rejects repeated taps while the same group is in flight.
 */
export class CommandGateway {
  readonly #connection: PrinterConnection | null;
  readonly #getState: () => PrinterState;
  readonly #inflight = new Set<string>();
  readonly #listeners = new Set<(busy: ReadonlySet<string>) => void>();
  readonly #settleTimeoutMs: number;
  readonly #settlePollMs: number;
  readonly #context: () => CommandContext;

  constructor(connection: PrinterConnection | null, getState: () => PrinterState, options: GatewayOptions = {}) {
    this.#connection = connection;
    this.#getState = getState;
    this.#settleTimeoutMs = options.settleTimeoutMs ?? 3000;
    this.#settlePollMs = options.settlePollMs ?? 50;
    this.#context = options.context ?? (() => EMPTY_COMMAND_CONTEXT);
  }

  /** False when no Moonraker endpoint is configured. */
  get live(): boolean {
    return this.#connection !== null;
  }

  availability(command: PrinterCommand): Availability {
    if (!this.#connection) return { allowed: false, message: 'Set up the printer connection in Settings' };
    const prepared = prepareCommand(command, this.#getState(), this.#context());
    return prepared.ok ? { allowed: true, note: prepared.plan.note } : { allowed: false, message: prepared.message };
  }

  /** The busy group a command belongs to, or null if it is not currently allowed. */
  groupOf(command: PrinterCommand): string | null {
    const prepared = prepareCommand(command, this.#getState(), this.#context());
    return prepared.ok ? prepared.plan.group : null;
  }

  isBusy(group: string): boolean {
    return this.#inflight.has(group);
  }

  onBusyChange(listener: (busy: ReadonlySet<string>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async execute(command: PrinterCommand, options: { confirmed?: boolean } = {}): Promise<CommandOutcome> {
    const connection = this.#connection;
    if (!connection) return { status: 'blocked', message: 'Set up the printer connection in Settings' };
    const prepared = prepareCommand(command, this.#getState(), this.#context());
    if (!prepared.ok) return { status: 'blocked', message: prepared.message };
    const plan = prepared.plan;

    if (plan.group !== ESTOP_GROUP && this.#inflight.has(plan.group)) {
      return { status: 'busy', message: 'Still waiting for the previous command' };
    }
    if (plan.confirm && !options.confirmed) return { status: 'needs_confirmation', confirm: plan.confirm };

    this.#setBusy(plan.group, true);
    try {
      await connection.call(plan.method, plan.params, { timeoutMs: plan.timeoutMs });
      if (plan.settled) await this.#waitFor(plan.settled);
      return { status: 'ok', summary: plan.summary, note: plan.note };
    } catch (error) {
      if (error instanceof RpcUnconfirmedError) {
        return { status: 'unconfirmed', summary: plan.summary, message: `${error.message}. Check the printer before retrying` };
      }
      const message = error instanceof RpcError ? cleanKlipperMessage(error.message) : errorMessage(error);
      return { status: 'failed', summary: plan.summary, message };
    } finally {
      this.#setBusy(plan.group, false);
    }
  }

  #setBusy(group: string, busy: boolean): void {
    if (group === ESTOP_GROUP) return;
    if (busy) this.#inflight.add(group);
    else this.#inflight.delete(group);
    for (const listener of this.#listeners) listener(this.#inflight);
  }

  /** Bounded by a poll count rather than wall-clock time, so a frozen or jumping clock cannot hang it. */
  async #waitFor(predicate: (state: PrinterState) => boolean): Promise<void> {
    const polls = Math.ceil(this.#settleTimeoutMs / this.#settlePollMs);
    for (let i = 0; i < polls; i++) {
      if (predicate(this.#getState())) return;
      await new Promise((resolve) => setTimeout(resolve, this.#settlePollMs));
    }
  }
}

/** Klipper errors arrive as e.g. `!! Must home axis first: 0.000 0.000 0.000 [0.000]`. */
export function cleanKlipperMessage(message: string): string {
  return message.replace(/^!!\s*/, '').trim() || 'The printer rejected the command';
}
