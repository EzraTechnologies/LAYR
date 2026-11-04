import type { AfcStatus } from '../afc/types';

/**
 * Printer view model. The live Moonraker source produces `PrinterState`; UI components only ever read this shape.
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

/**
 * Whether the connected Moonraker exposes `machine.reboot` and `machine.shutdown`.
 * `unknown` until `server.info` includes a component list. Never guessed.
 */
export type HostMachine = 'unknown' | 'available' | 'unavailable';

/** Top-level status shown to the user. `unconfigured` means no Moonraker endpoint has been set up yet. */
export type PrinterStatus = 'unconfigured' | 'disconnected' | 'connecting' | 'ready' | 'printing' | 'paused' | 'error';

export type Axis = 'x' | 'y' | 'z';
export const AXES: readonly Axis[] = ['x', 'y', 'z'];

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
  /** G-code thumbnail path relative to the gcodes root, or null when metadata has none. */
  thumbnailPath: string | null;
}

/**
 * Live motion from Klipper `motion_report`, not from `speed_factor` / `extrude_factor`.
 * Values are quantized so tiny changes do not re-render the dashboard.
 */
export interface MotionTelemetry {
  /** `motion_report.live_velocity` in mm/s, or null when Klipper did not report it. */
  speedMmS: number | null;
  /**
   * Volumetric flow in mm³/s: live extruder velocity × filament area.
   * Negative means retraction. Null when velocity or filament diameter is unavailable.
   */
  flowMm3S: number | null;
  /** Diameter used for the area, in mm, or null when the config does not provide a usable one. */
  filamentDiameterMm: number | null;
  /** Why `flowMm3S` is null. Null when a flow number (including 0) was calculated. */
  flowGap: 'velocity' | 'diameter' | null;
}

export interface ToolheadInfo {
  /** Homed axes as reported by `toolhead.homed_axes`, e.g. `"xyz"`. */
  homedAxes: string;
  /** Last commanded position (x, y, z, e) in the config coordinate system. */
  position: [number, number, number, number] | null;
  axisMin: [number, number, number] | null;
  axisMax: [number, number, number] | null;
  maxVelocity: number | null;
  /** Current `SET_GCODE_OFFSET` Z (`gcode_move.homing_origin[2]`). */
  zOffset: number | null;
  speedFactor: number | null;
  extrudeFactor: number | null;
}

export interface FanReading {
  object: string;
  label: string;
  /** 0..1 */
  speed: number | null;
  rpm: number | null;
  /** True for `fan` (M106) and `fan_generic` (SET_FAN_SPEED); heater/controller fans are automatic. */
  controllable: boolean;
}

export interface LightControl {
  object: string;
  label: string;
  kind: 'pin' | 'led';
  /** 0..1 brightness, or null when unknown. */
  value: number | null;
  dimmable: boolean;
  /** `output_pin` `scale` option; `SET_PIN VALUE` is expressed in this unit. */
  scale: number;
}

export interface MacroInfo {
  /** Command name as typed in the console, upper case. */
  name: string;
  description: string | null;
  /** Parameter names referenced as `params.X` in the macro template. */
  params: string[];
  /** Parameters without a default; the macro must not be run without them. */
  requiredParams: string[];
  /** Macros prefixed with `_` are treated as internal. */
  hidden: boolean;
}

export interface FilamentSensor {
  object: string;
  label: string;
  detected: boolean | null;
  enabled: boolean | null;
}

/** Documented Happy Hare `gate_status` values, plus an honest bucket for anything else. */
export type MmuGateStatus = 'unknown' | 'empty' | 'available' | 'buffer' | 'unrecognized';

/** One physical gate, using only values Happy Hare actually sent. */
export interface MmuGate {
  index: number;
  status: MmuGateStatus | null;
  /** Present when `status` is `unrecognized` and the raw value was an integer. */
  statusCode: number | null;
  filamentName: string | null;
  material: string | null;
  /** `#rrggbb` only. Empty Happy Hare colors are not painted as black. */
  color: string | null;
  colorName: string | null;
  temperature: number | null;
  spoolId: number | null;
  /** Tool indexes whose tool-to-gate map entry points here. Empty when the map was not sent. */
  tools: number[];
}

/**
 * Happy Hare state for the Chromium UI. Null on `PrinterState` when the printer
 * did not list an `mmu` object, or when Klipper is not ready (no stale values).
 */
export interface MmuState {
  /** True once the `mmu` status object contained at least one field. */
  statusSeen: boolean;
  enabled: boolean | null;
  homed: boolean | null;
  /** `num_gates`, or the length of a reported gate/tool array when that count is missing. */
  numGates: number | null;
  /** `-1` unknown, `-2` bypass, `0..n` tool. Null when the field was absent. */
  tool: number | null;
  gate: number | null;
  lastTool: number | null;
  nextTool: number | null;
  /** Coarse `filament` string when it is one of the three documented words. */
  filament: 'Loaded' | 'Unloaded' | 'Unknown' | null;
  /** `filament` text that was present but not one of those three words. */
  filamentRaw: string | null;
  /** State-machine code from `filament_pos` (or a legacy integer `filament_position`). */
  filamentPos: number | null;
  filamentPosition: string | null;
  /** True when the coarse word and the state-machine code disagree. */
  filamentDisagreement: boolean;
  action: string | null;
  printState: string | null;
  /** `is_paused` / `is_locked` only when `print_state` was not sent. */
  paused: boolean | null;
  reasonForPause: string | null;
  ttgReported: boolean;
  gates: MmuGate[];
  /** Reported gates past the on-screen cap. */
  hiddenGates: number;
  /**
   * Supported commands present in `printer.gcode.help`.
   * Null when that query failed. An empty list means the query succeeded and none were registered.
   */
  commands: readonly string[] | null;
}

export interface HeaterLimits {
  minTemp: number;
  maxTemp: number;
}

/** Limits read from Klipper's `configfile.settings`, or conservative fallbacks when unavailable. */
export interface PrinterLimits {
  /** True when the values below come from the printer's configuration. */
  fromConfig: boolean;
  extruder: HeaterLimits & {
    minExtrudeTemp: number;
    maxExtrudeOnlyDistance: number;
    maxExtrudeOnlyVelocity: number | null;
  };
  bed: HeaterLimits | null;
  /** Additional heaters (`heater_generic`), keyed by object name. */
  heaters: Record<string, HeaterLimits>;
  maxVelocity: number | null;
  maxZVelocity: number | null;
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
  /**
   * `print_stats.state`, including when no file is loaded (`standby` with a null job).
   * Null when Klipper did not report `print_stats`. `unknown` when the value was not a known state.
   */
  printState: JobState | null;
  extruder: HeaterReading | null;
  bed: HeaterReading | null;
  chamber: HeaterReading | null;
  /** Additional temperature sensors / generic heaters, excluding the chamber. */
  sensors: HeaterReading[];
  /** `extruder.can_extrude`: false while below `min_extrude_temp`. */
  canExtrude: boolean | null;
  /** Klipper-reported live speed and volumetric flow. Empty when disconnected or unreported. */
  motion: MotionTelemetry;
  toolhead: ToolheadInfo | null;
  fans: FanReading[];
  lights: LightControl[];
  macros: MacroInfo[];
  filamentSensors: FilamentSensor[];
  /**
   * AFC add-on, when this printer's object list contains `AFC` and Klipper is ready.
   * Null on printers without AFC, and whenever live object data is hidden.
   */
  afc: AfcStatus | null;
  /** Happy Hare, when this printer listed the `mmu` object and Klipper is ready. */
  mmu: MmuState | null;
  limits: PrinterLimits;
  /** `idle_timeout.state`: `Idle`, `Ready` or `Printing` (Klipper is busy executing G-code). */
  idleState: string | null;
  /** printer host power via Moonraker `machine.reboot` / `machine.shutdown`. */
  hostMachine: HostMachine;
  /** Requested Klipper objects that this printer does not provide. */
  missingObjects: string[];
  /** Epoch ms "now" used for clock/ETA rendering. */
  now: number;
}

export const FALLBACK_LIMITS: PrinterLimits = {
  fromConfig: false,
  extruder: { minTemp: 0, maxTemp: 280, minExtrudeTemp: 170, maxExtrudeOnlyDistance: 50, maxExtrudeOnlyVelocity: null },
  bed: { minTemp: 0, maxTemp: 110 },
  heaters: {},
  maxVelocity: null,
  maxZVelocity: null,
};

export function createInitialState(printerId: string, printerName: string, now: number, configured = true): PrinterState {
  return {
    printerId,
    printerName,
    hostname: null,
    status: configured ? 'disconnected' : 'unconfigured',
    statusDetail: null,
    transport: 'idle',
    klippy: 'unknown',
    reconnectAttempt: 0,
    nextRetryAt: null,
    job: null,
    printState: null,
    extruder: null,
    bed: null,
    chamber: null,
    sensors: [],
    canExtrude: null,
    motion: { speedMmS: null, flowMm3S: null, filamentDiameterMm: null, flowGap: 'velocity' },
    toolhead: null,
    fans: [],
    lights: [],
    macros: [],
    filamentSensors: [],
    afc: null,
    mmu: null,
    limits: structuredClone(FALLBACK_LIMITS),
    idleState: null,
    hostMachine: 'unknown',
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

/**
 * True when Klipper is connected and accepting commands. Note a `print_stats` error (status `error` with
 * Klippy `ready`) still accepts commands, so this is based on Klippy, not on the derived status.
 */
export function isKlippyReady(state: Pick<PrinterState, 'transport' | 'klippy'>): boolean {
  return state.transport === 'connected' && state.klippy === 'ready';
}

export function isHomed(state: Pick<PrinterState, 'toolhead'>, axis: Axis): boolean {
  return !!state.toolhead && state.toolhead.homedAxes.includes(axis);
}
