import { mapJob, mapTemperatures, parseJobState } from '../moonraker/mapping';
import type { RawStatus } from '../moonraker/types';
import { deriveStatus, type KlippyState, type PrinterState, type TransportState } from './model';

export interface AssembleInputs {
  printerId: string;
  /** Configured display name; empty to fall back to the host name. */
  configuredName: string;
  hostname: string | null;
  transport: TransportState;
  klippy: KlippyState;
  klippyMessage: string | null;
  reconnectAttempt: number;
  nextRetryAt: number | null;
  transportReason: string | null;
  raw: RawStatus;
  slicerEstimate: number | null;
  missingObjects: string[];
  now: number;
}

/** Builds the UI state from raw Moonraker data. Shared by the live and demo sources. */
export function assembleState(input: AssembleInputs): PrinterState {
  const connected = input.transport === 'connected' && input.klippy === 'ready';
  // Object data is only trustworthy while Klipper is ready; otherwise show no live values.
  const raw = connected ? input.raw : {};
  const job = mapJob(raw, input.slicerEstimate);
  const temps = mapTemperatures(raw);
  const jobState = raw.print_stats ? parseJobState(raw.print_stats.state) : null;

  const { status, detail } = deriveStatus({
    transport: input.transport,
    klippy: input.klippy,
    jobState,
    klippyMessage: input.klippyMessage,
    jobMessage: job?.message ?? null,
  });

  let statusDetail = detail;
  if (input.transport === 'waiting') {
    statusDetail = input.transportReason ? `${input.transportReason}. Retrying automatically` : 'Retrying automatically';
  }

  return {
    printerId: input.printerId,
    printerName: input.configuredName || input.hostname || 'Klipper printer',
    hostname: input.hostname,
    status,
    statusDetail,
    transport: input.transport,
    klippy: input.klippy,
    reconnectAttempt: input.reconnectAttempt,
    nextRetryAt: input.transport === 'waiting' ? input.nextRetryAt : null,
    job,
    extruder: temps.extruder,
    bed: temps.bed,
    chamber: temps.chamber,
    sensors: temps.sensors,
    missingObjects: connected ? input.missingObjects : [],
    now: input.now,
  };
}
