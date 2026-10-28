import { CommandGateway } from '../actions/gateway';
import { EMPTY_COMMAND_CONTEXT, type CommandContext } from '../actions/commands';
import { createInitialState, type PrinterState } from './model';
import { patchInPlace } from './patch';
import type { PrinterSource } from './source';

/** Reactive holder for one printer's state. Components read `store.state`; only changed fields re-render. */
export class PrinterStore {
  readonly state: PrinterState;
  readonly source: PrinterSource;
  readonly commands: CommandGateway;
  #started = false;
  #context: CommandContext = { ...EMPTY_COMMAND_CONTEXT };

  constructor(source: PrinterSource, printerName = '') {
    this.source = source;
    this.state = $state(createInitialState(source.printerId, printerName, Date.now(), source.kind === 'live'));
    this.commands = new CommandGateway(source.connection, () => this.state, { context: () => this.#context });
  }

  /** Merges facts used by `prepareCommand` (Spoolman, and later the G-code help list). */
  updateCommandContext(patch: Partial<CommandContext>): void {
    this.#context = { ...this.#context, ...patch };
  }

  get configured(): boolean {
    return this.source.kind === 'live';
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.source.start((next) => {
      patchInPlace(this.state as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    });
  }

  stop(): void {
    this.#started = false;
    this.source.stop();
  }
}
