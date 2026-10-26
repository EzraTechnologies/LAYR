/**
 * Every action that could change the physical printer must go through a `CommandGateway`.
 * LAYR v0.1 ships no gateway that can execute anything: live mode reports "not yet supported" and demo mode
 * reports "demo". When printer control is added, a live gateway must require an explicit confirmation step
 * and must never be constructed while demo mode is active.
 */

export type PrinterCommand =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'cancel' }
  | { kind: 'emergency_stop' }
  | { kind: 'set_temperature'; heater: string; target: number };

export type CommandBlockReason = 'demo' | 'unsupported';

export type CommandAvailability = { allowed: true } | { allowed: false; reason: CommandBlockReason; message: string };

export interface CommandGateway {
  readonly mode: 'demo' | 'live';
  availability(command: PrinterCommand): CommandAvailability;
  /** Rejects unless `availability(command).allowed`. */
  execute(command: PrinterCommand): Promise<void>;
}

export class CommandBlockedError extends Error {
  readonly reason: CommandBlockReason;
  constructor(reason: CommandBlockReason, message: string) {
    super(message);
    this.name = 'CommandBlockedError';
    this.reason = reason;
  }
}

class BlockingGateway implements CommandGateway {
  readonly mode: 'demo' | 'live';
  readonly #reason: CommandBlockReason;
  readonly #message: string;

  constructor(mode: 'demo' | 'live', reason: CommandBlockReason, message: string) {
    this.mode = mode;
    this.#reason = reason;
    this.#message = message;
  }

  availability(): CommandAvailability {
    return { allowed: false, reason: this.#reason, message: this.#message };
  }

  execute(): Promise<void> {
    return Promise.reject(new CommandBlockedError(this.#reason, this.#message));
  }
}

export function createCommandGateway(mode: 'demo' | 'live'): CommandGateway {
  return mode === 'demo'
    ? new BlockingGateway('demo', 'demo', 'Demo mode: printer actions are disabled')
    : new BlockingGateway('live', 'unsupported', 'Printer control is not available in LAYR v0.1');
}
