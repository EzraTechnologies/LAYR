import type { PrinterState } from './model';

/**
 * A producer of `PrinterState` for one printer. The UI never talks to Moonraker directly; it subscribes to a
 * source. Live and demo sources implement the same interface, which keeps demo data isolated from the network
 * and leaves room for one source per printer in a future multi-printer view.
 */
export interface PrinterSource {
  readonly kind: 'live' | 'demo';
  readonly printerId: string;
  /** Begins producing state. `onState` may be called many times; each call carries the full state. */
  start(onState: (state: PrinterState) => void): void;
  stop(): void;
}
