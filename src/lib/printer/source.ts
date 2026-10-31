import type { CallOptions } from '../moonraker/client';
import type { ServerInfo } from '../moonraker/types';
import type { SpoolmanNotice } from '../spoolman/api';
import type { PrinterState, TransportState } from './model';

/**
 * A producer of `PrinterState` for one printer. The UI never talks to Moonraker directly; it subscribes to a
 * source, which leaves room for one source per printer in a future multi-printer view.
 */
export interface PrinterSource {
  /** `unconfigured` sources never open a connection; they exist until a Moonraker URL is set up. */
  readonly kind: 'live' | 'unconfigured';
  readonly printerId: string;
  /** Present for live sources. Commands, files and the console go through it. */
  readonly connection: PrinterConnection | null;
  /** Begins producing state. `onState` may be called many times; each call carries the full state. */
  start(onState: (state: PrinterState) => void): void;
  stop(): void;
}

export interface PrinterConnection {
  readonly hasApiKey: boolean;
  readonly connected: boolean;
  call<T = unknown>(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T>;
  httpUrl(path: string): string;
  fetchHttp(path: string, signal?: AbortSignal): Promise<Response>;
  reconnect(): void;
  /** Called after every (re)subscription, i.e. whenever fresh printer state is available. */
  onReady(listener: () => void): () => void;
  onGcodeResponse(listener: (message: string) => void): () => void;
  onFilelistChanged(listener: (change: { action: string; path: string | null; root: string | null }) => void): () => void;
  onTransport(listener: (state: TransportState) => void): () => void;
  /** Each successful `server.info`, including the component list. */
  onServerInfo(listener: (info: ServerInfo) => void): () => void;
  onSpoolmanNotice(listener: (notice: SpoolmanNotice) => void): () => void;
}

/** Emits a single "not configured" state and never touches the network. */
export class UnconfiguredSource implements PrinterSource {
  readonly kind = 'unconfigured' as const;
  readonly connection = null;
  readonly printerId: string;
  readonly #initial: PrinterState;

  constructor(initial: PrinterState) {
    this.printerId = initial.printerId;
    this.#initial = initial;
  }

  start(onState: (state: PrinterState) => void): void {
    onState(structuredClone(this.#initial));
  }

  stop(): void {}
}
