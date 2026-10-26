import type { CommandGateway } from '../actions/commands';
import { createInitialState, type PrinterState } from './model';
import { patchInPlace } from './patch';
import type { PrinterSource } from './source';

/** Reactive holder for one printer's state. Components read `store.state`; only changed fields re-render. */
export class PrinterStore {
  readonly state: PrinterState;
  readonly source: PrinterSource;
  readonly commands: CommandGateway;
  #started = false;

  constructor(source: PrinterSource, commands: CommandGateway, printerName = '') {
    this.source = source;
    this.commands = commands;
    this.state = $state(createInitialState(source.printerId, printerName, Date.now()));
  }

  get isDemo(): boolean {
    return this.source.kind === 'demo';
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
