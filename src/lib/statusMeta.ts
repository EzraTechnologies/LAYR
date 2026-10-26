import type { PrinterState, PrinterStatus } from './printer/model';

export interface StatusMeta {
  label: string;
  /** CSS colour variable name for the status accent. */
  tone: 'cyan' | 'purple' | 'ok' | 'warn' | 'danger' | 'dim';
}

export const STATUS_META: Record<PrinterStatus, StatusMeta> = {
  disconnected: { label: 'Offline', tone: 'dim' },
  connecting: { label: 'Connecting', tone: 'purple' },
  ready: { label: 'Ready', tone: 'ok' },
  printing: { label: 'Printing', tone: 'cyan' },
  paused: { label: 'Paused', tone: 'warn' },
  error: { label: 'Error', tone: 'danger' },
};

/** A more specific label for the hero card, e.g. "Preparing" before the first layer starts. */
export function headline(state: PrinterState): string {
  const job = state.job;
  if (state.status === 'printing' && job && (job.printDuration ?? 0) === 0) return 'Preparing';
  if (state.status === 'ready' && job?.state === 'complete') return 'Print complete';
  if (state.status === 'ready' && job?.state === 'cancelled') return 'Print cancelled';
  return STATUS_META[state.status].label;
}
