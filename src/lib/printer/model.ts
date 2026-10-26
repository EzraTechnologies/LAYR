/**
 * Source-agnostic printer view model. Both the live Moonraker source and the demo source
 * produce `PrinterState`; UI components only ever read this shape.
 */

/** Low-level WebSocket transport state. */
export type TransportState =
  /** Not started, or stopped deliberately. */
  | 'idle'
  /** A connection attempt (token fetch, socket open, identify, initial query) is in progress. */
  | 'connecting'
  /** Socket is open and identified with Moonraker. */
  | 'connected'
  /** Connection was lost or failed; waiting for the next backoff retry. */
  | 'waiting';

/** Klippy host state as reported by Moonraker (`server.info.klippy_state`). */
export type KlippyState = 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected' | 'unknown';

/** `print_stats.state` values reported by Klipper. */
export type JobState = 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error' | 'unknown';

/** Top-level status shown to the user. */
export type PrinterStatus = 'disconnected' | 'connecting' | 'ready' | 'printing' | 'paused' | 'error';

export interface HeaterReading {
  /** Klipper object name, e.g. `extruder`, `heater_bed`, `temperature_sensor chamber`. */
  object: string;
  label: string;
  /** Current temperature in °C, or null when not reported yet. */
  temperature: number | null;
  /** Target temperature in °C. Null for plain sensors that cannot be heated. */
  target: number | null;
  /** Heater duty cycle 0..1. Null for plain sensors. */
  power: number | null;
}

export interface JobInfo {
  /** Path relative to the gcodes root, as reported by `print_stats.filename`. */
  filename: string;
  state: JobState;
  /** 0..1 progress, or null when unknown. */
  progress: number | null;
  /** Seconds spent actively printing (excludes pauses). */
  printDuration: number | null;
  /** Seconds since the job started (includes pauses). */
  totalDuration: number | null;
  /** Estimated seconds remaining, or null when no reasonable estimate exists. */
  remaining: number | null;
  /** Where the remaining estimate came from. */
  remainingSource: 'progress' | 'slicer' | null;
  currentLayer: number | null;
  totalLayers: number | null;
  /** Filament used in mm. */
  filamentUsed: number | null;
  /** `print_stats.message` / `display_status.message`, if any. */
  message: string | null;
}

export interface PrinterState {
  /** Stable id of the printer profile this state belongs to. */
  printerId: string;
  printerName: string;
  /** Host name reported by Klipper, if known. */
  hostname: string | null;
  status: PrinterStatus;
  /** Human readable explanation for the current status (errors, retry info). */
  statusDetail: string | null;
  transport: TransportState;
  klippy: KlippyState;
  /** Number of consecutive failed connection attempts. */
  reconnectAttempt: number;
  /** Epoch ms of the next scheduled reconnect, when `transport === 'waiting'`. */
  nextRetryAt: number | null;
  job: JobInfo | null;
  extruder: HeaterReading | null;
  bed: HeaterReading | null;
  chamber: HeaterReading | null;
  /** Additional temperature sensors / generic heaters, excluding the chamber. */
  sensors: HeaterReading[];
  /** Requested Klipper objects that this printer does not provide. */
  missingObjects: string[];
  /** Epoch ms "now" used for clock/ETA rendering. Frozen in demo mode for deterministic output. */
  now: number;
}

export function createInitialState(printerId: string, printerName: string, now: number): PrinterState {
  return {
    printerId,
    printerName,
    hostname: null,
    status: 'disconnected',
    statusDetail: null,
    transport: 'idle',
    klippy: 'unknown',
    reconnectAttempt: 0,
    nextRetryAt: null,
    job: null,
    extruder: null,
    bed: null,
    chamber: null,
    sensors: [],
    missingObjects: [],
    now,
  };
}

export interface StatusInputs {
  transport: TransportState;
  klippy: KlippyState;
  jobState: JobState | null;
  klippyMessage?: string | null;
  jobMessage?: string | null;
}

/**
 * Derives the user-facing status from transport, Klippy and job state.
 * Order matters: transport problems trump Klippy problems, which trump job state.
 */
export function deriveStatus(input: StatusInputs): { status: PrinterStatus; detail: string | null } {
  const { transport, klippy, jobState } = input;

  if (transport === 'idle' || transport === 'waiting') {
    return { status: 'disconnected', detail: null };
  }
  if (transport === 'connecting') {
    return { status: 'connecting', detail: 'Connecting to Moonraker' };
  }

  switch (klippy) {
    case 'unknown':
      return { status: 'connecting', detail: 'Waiting for Klipper state' };
    case 'startup':
      return { status: 'connecting', detail: input.klippyMessage || 'Klipper is starting' };
    case 'disconnected':
      return { status: 'disconnected', detail: 'Moonraker is online but Klipper is not connected' };
    case 'shutdown':
    case 'error':
      return { status: 'error', detail: input.klippyMessage || `Klipper ${klippy}` };
    case 'ready':
      break;
  }

  switch (jobState) {
    case 'printing':
      return { status: 'printing', detail: null };
    case 'paused':
      return { status: 'paused', detail: input.jobMessage || null };
    case 'error':
      return { status: 'error', detail: input.jobMessage || 'Print failed' };
    default:
      return { status: 'ready', detail: null };
  }
}

/** Statuses during which the job card should show live job details. */
export function isJobActive(status: PrinterStatus): boolean {
  return status === 'printing' || status === 'paused';
}
