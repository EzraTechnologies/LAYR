import type { CommandGateway } from '../actions/gateway';
import type { Confirmation } from '../actions/commands';
import type { PrinterProfile } from '../config';
import type { ServerInfo } from '../moonraker/types';
import type { PrinterConnection } from '../printer/source';
import type { TransportState } from '../printer/model';
import { emptySnapshot, type SpoolmanSnapshot } from './api';
import { SpoolmanSession } from './session';
import type { SpoolSummary, UnloadOutcome } from './types';

/** Reactive Spoolman state for the active printer. Prints do not wait on it. */
export class SpoolmanLive {
  snapshot = $state<SpoolmanSnapshot>(emptySnapshot('', ''));
  readonly #session: SpoolmanSession;
  #stop: Array<() => void> = [];

  constructor(
    printer: PrinterProfile,
    connection: PrinterConnection | null,
    gateway: CommandGateway,
    confirm: (confirm: Confirmation) => Promise<boolean>,
  ) {
    const endpoint = printer.moonrakerUrl ?? '';
    this.snapshot = emptySnapshot(printer.id, endpoint);
    this.#session = new SpoolmanSession(
      {
        printerId: printer.id,
        endpoint,
        call: connection ? (method, params) => connection.call(method, params) : null,
        execute: connection ? (command, options) => gateway.execute(command, options) : null,
        confirm,
      },
      (next) => {
        this.snapshot = next;
      },
    );
  }

  start(connection: PrinterConnection | null): void {
    if (!connection) return;
    this.#stop.push(
      connection.onTransport((state: TransportState) => {
        if (state !== 'connected') this.#session.dropConnection();
      }),
    );
    this.#stop.push(
      connection.onServerInfo((info: ServerInfo) => {
        void this.#session.onServerInfo(info);
      }),
    );
    this.#stop.push(connection.onSpoolmanNotice((notice) => this.#session.onNotice(notice)));
  }

  stop(): void {
    for (const unsubscribe of this.#stop) unsubscribe();
    this.#stop = [];
    this.#session.dropConnection();
  }

  get tracked(): boolean {
    return this.snapshot.tracked;
  }

  /** True when an unload from Extrude may clear the active spool after Klipper accepts it. */
  get willClearOnUnload(): boolean {
    return this.snapshot.phase === 'ready' && this.snapshot.activeKnown && this.snapshot.activeId != null;
  }

  activeSpool(): SpoolSummary | null {
    const id = this.snapshot.activeId;
    if (!this.snapshot.activeKnown || id == null) return null;
    return this.snapshot.spools.find((spool) => spool.id === id) ?? null;
  }

  refresh(): Promise<void> {
    return this.#session.refresh();
  }

  select(spool: SpoolSummary): Promise<void> {
    return this.#session.setActiveSpool(this.snapshot.printerId, spool.id).then(() => this.#session.refresh());
  }

  clearAfterUnload(outcome: UnloadOutcome): Promise<'cleared' | 'kept' | 'skipped'> {
    return this.#session.clearAfterUnload(this.snapshot.printerId, outcome);
  }
}
