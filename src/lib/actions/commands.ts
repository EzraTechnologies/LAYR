import { objectSuffix } from '../moonraker/objects';
import type { SpoolmanFacts } from '../spoolman/types';
import { prepareSpoolmanCommand } from '../spoolman/plan';
import {
  AXES,
  FALLBACK_LIMITS,
  isHomed,
  type Axis,
  type HeaterLimits,
  type HeaterReading,
  type PrinterState,
} from '../printer/model';

/**
 * Every action that can change the physical printer is a `PrinterCommand`. `prepareCommand` is the single place
 * that decides whether a command is allowed in the current state, clamps it to safe values, turns it into a
 * Moonraker request and says whether the user has to confirm it first. It is pure so it can be unit-tested.
 */
export type PrinterCommand =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'cancel' }
  | { kind: 'emergency_stop' }
  | { kind: 'firmware_restart' }
  | { kind: 'restart' }
  /** Empty `axes` homes all axes. */
  | { kind: 'home'; axes: Axis[] }
  /** Relative move in mm at `speed` mm/s. */
  | { kind: 'jog'; axis: Axis; distance: number; speed: number }
  | { kind: 'motors_off' }
  /** Babystep: adjusts the G-code Z offset by `delta` mm and moves the nozzle. */
  | { kind: 'z_offset'; delta: number }
  /** Positive `length` extrudes, negative retracts (mm of filament at `speed` mm/s). */
  | { kind: 'extrude'; length: number; speed: number }
  | { kind: 'set_temperature'; heater: string; target: number }
  /**
   * M220 speed override, in percent (100 = no change). This is not the live mm/s readout.
   * Clamped to 10–200.
   */
  | { kind: 'set_speed_factor'; percent: number }
  /**
   * M221 extrude override, in percent (100 = no change). This is not the live mm³/s readout.
   * Clamped to 10–200.
   */
  | { kind: 'set_extrude_factor'; percent: number }
  /** `speed` is 0..1. */
  | { kind: 'set_fan'; fan: string; speed: number }
  /** `value` is 0..1. */
  | { kind: 'set_light'; light: string; value: number }
  | { kind: 'macro'; name: string }
  /** A single line typed by the user in the console. */
  | { kind: 'gcode'; script: string }
  | { kind: 'start_print'; filename: string }
  | { kind: 'delete_file'; path: string }
  /** Moonraker `server.spoolman.post_spool_id`. Confirmed, and locked while a print is active. */
  | { kind: 'set_active_spool'; spoolId: number }
  | { kind: 'clear_active_spool'; authorized?: boolean }
  /** Runs a parameter-free unload macro. The spool is cleared only after Klipper accepts it. */
  | { kind: 'unload_for_spool_clear'; macro: string };

export type CommandKind = PrinterCommand['kind'];

export interface Confirmation {
  title: string;
  body: string;
  confirmLabel: string;
  /** Label of the dismiss button; defaults to "Go back". */
  cancelLabel?: string;
  tone: 'primary' | 'warn' | 'danger';
}

export interface CommandPlan {
  method: string;
  params?: Record<string, unknown>;
  timeoutMs: number;
  /** Short past-tense-free description for feedback, e.g. "Home all axes". */
  summary: string;
  /** Commands in the same group cannot run concurrently; repeated taps are rejected while one is in flight. */
  group: string;
  confirm: Confirmation | null;
  /** Extra information about how the command was adjusted, e.g. clamping to an axis limit. */
  note: string | null;
  /**
   * After the request succeeds, the command stays busy until this returns true for the latest state (or a
   * timeout passes). Used by jogs so a rapid second tap is checked against the updated position.
   */
  settled?: (state: PrinterState) => boolean;
}

export type Prepared = { ok: true; plan: CommandPlan } | { ok: false; message: string };

/** Largest single jog. Bigger moves should be typed deliberately in the console. */
export const MAX_JOG_MM = 100;
/** Jogging Z never goes below this, even if `position_min` is negative (e.g. for probe calibration). */
export const Z_JOG_FLOOR_MM = 0;
export const DEFAULT_MAX_Z_SPEED = 10;
export const MAX_XY_JOG_SPEED = 300;
export const MAX_EXTRUDE_MM = 100;
export const MAX_EXTRUDE_SPEED = 15;
export const MAX_Z_OFFSET_STEP = 0.1;
export const MAX_Z_OFFSET_TOTAL = 2;
export const MAX_CONSOLE_LENGTH = 256;
export const MACRO_TIMEOUT_MS = 15 * 60_000;
export const CONSOLE_TIMEOUT_MS = 30 * 60_000;

/** Targets at or above these need an extra confirmation. */
export const HIGH_TEMP_CONFIRM: Record<'extruder' | 'bed' | 'other', number> = { extruder: 270, bed: 105, other: 70 };

/** Console commands that get a stronger warning in the confirmation. */
const RISKY_GCODE_RE =
  /^(FIRMWARE_RESTART|RESTART|SAVE_CONFIG|M84|M18|G28|SET_KINEMATIC_POSITION|FORCE_MOVE|SET_STEPPER_ENABLE|STEPPER_BUZZ|PID_CALIBRATE|Z_TILT_ADJUST|QUAD_GANTRY_LEVEL|BED_MESH_CALIBRATE|PROBE_CALIBRATE|Z_ENDSTOP_CALIBRATE|MANUAL_PROBE)\b/i;
const MACRO_NAME_RE = /^[A-Z0-9_]+$/;

const SECOND = 1000;
/** Emergency stops are never rejected as "busy". */
export const ESTOP_GROUP = 'estop';

function fail(message: string): Prepared {
  return { ok: false, message };
}

function ok(plan: Omit<CommandPlan, 'confirm' | 'note'> & Partial<Pick<CommandPlan, 'confirm' | 'note'>>): Prepared {
  return { ok: true, plan: { confirm: null, note: null, ...plan } };
}

function fmt(value: number, digits = 3): string {
  return String(Number(value.toFixed(digits)));
}

function gcodeScript(lines: string[], summary: string, group: string, timeoutMs: number, extra: Partial<CommandPlan> = {}): Prepared {
  return ok({ method: 'printer.gcode.script', params: { script: lines.join('\n') }, summary, group, timeoutMs, ...extra });
}

/** M220 / M221 percentage. Separate from the live mm/s and mm³/s dashboard values. */
const MIN_FEEDRATE_PERCENT = 10;
const MAX_FEEDRATE_PERCENT = 200;

function feedrateOverride(code: 'M220' | 'M221', label: string, percent: number): Prepared {
  if (!Number.isFinite(percent)) return fail('Enter a percentage');
  const rounded = Math.round(percent);
  const clamped = Math.min(MAX_FEEDRATE_PERCENT, Math.max(MIN_FEEDRATE_PERCENT, rounded));
  return gcodeScript([`${code} S${clamped}`], `${label} ${clamped}%`, 'feedrate', 10 * SECOND, {
    note: clamped === rounded ? null : `Limited to ${clamped}%`,
  });
}

/** Klipper must be connected and ready. Returns an explanation when it is not. */
function readyGate(state: PrinterState): string | null {
  if (state.status === 'unconfigured') return 'Set up the printer connection in Settings';
  if (state.transport !== 'connected') return 'Printer is offline';
  if (state.klippy === 'ready') return null;
  if (state.klippy === 'shutdown' || state.klippy === 'error') return 'Klipper is in an error state. Restart it first';
  if (state.klippy === 'startup') return 'Klipper is starting';
  return 'Klipper is not connected';
}

/** Moonraker is connected and Klipper is reachable (ready, starting or shut down). */
function hostGate(state: PrinterState): string | null {
  if (state.status === 'unconfigured') return 'Set up the printer connection in Settings';
  if (state.transport !== 'connected') return 'Printer is offline';
  if (state.klippy === 'disconnected' || state.klippy === 'unknown') return 'Klipper is not connected';
  return null;
}

function isPrinting(state: PrinterState): boolean {
  return state.job?.state === 'printing';
}

function isPaused(state: PrinterState): boolean {
  return state.job?.state === 'paused';
}

function jobActive(state: PrinterState): boolean {
  return isPrinting(state) || isPaused(state);
}

function axisLabel(axis: Axis): string {
  return axis.toUpperCase();
}

export function heaterReadings(state: PrinterState): HeaterReading[] {
  return [state.extruder, state.bed, state.chamber, ...state.sensors].filter(
    (h): h is HeaterReading => h !== null && h.target !== null && !h.object.startsWith('temperature_fan '),
  );
}

export function heaterLimitsFor(state: PrinterState, heater: string): HeaterLimits {
  const limits = state.limits;
  if (heater === 'extruder') return limits.extruder;
  if (heater === 'heater_bed') return limits.bed ?? FALLBACK_LIMITS.bed!;
  return limits.heaters[heater.toLowerCase()] ?? { minTemp: 0, maxTemp: 100 };
}

function heaterKind(heater: string): keyof typeof HIGH_TEMP_CONFIRM {
  return heater === 'extruder' ? 'extruder' : heater === 'heater_bed' ? 'bed' : 'other';
}

/** `extruder` → `extruder`, `heater_generic chamber` → `chamber` (the HEATER= argument). */
function heaterArgument(heater: string): string {
  return heater.includes(' ') ? objectSuffix(heater) : heater;
}

function jogSpeedLimit(state: PrinterState, axis: Axis): number {
  if (axis === 'z') return Math.min(state.limits.maxZVelocity ?? DEFAULT_MAX_Z_SPEED, 25);
  return Math.min(state.toolhead?.maxVelocity ?? state.limits.maxVelocity ?? 150, MAX_XY_JOG_SPEED);
}

/** The usable travel for jogging an axis, or null when the printer has not reported its limits. */
export function jogRange(state: PrinterState, axis: Axis): { min: number; max: number } | null {
  const th = state.toolhead;
  if (!th?.axisMin || !th.axisMax) return null;
  const i = AXES.indexOf(axis);
  const min = axis === 'z' ? Math.max(th.axisMin[i]!, Z_JOG_FLOOR_MM) : th.axisMin[i]!;
  return { min, max: th.axisMax[i]! };
}

function prepareJog(state: PrinterState, axis: Axis, distance: number, speed: number): Prepared {
  if (!AXES.includes(axis)) return fail('Unknown axis');
  if (!Number.isFinite(distance) || distance === 0) return fail('Choose a distance');
  if (Math.abs(distance) > MAX_JOG_MM) return fail(`Moves are limited to ${MAX_JOG_MM} mm per step`);
  if (!Number.isFinite(speed) || speed <= 0) return fail('Choose a speed');
  if (!isHomed(state, axis)) return fail(`Home ${axisLabel(axis)} first`);
  const position = state.toolhead?.position;
  const range = jogRange(state, axis);
  if (!position || !range) return fail('Toolhead position is not available yet');

  const i = AXES.indexOf(axis);
  const current = position[i]!;
  const target = Math.min(range.max, Math.max(range.min, current + distance));
  const delta = Math.round((target - current) * 1000) / 1000;
  if (Math.abs(delta) < 0.001) {
    const edge = distance > 0 ? 'maximum' : axis === 'z' ? 'safe minimum' : 'minimum';
    return fail(`${axisLabel(axis)} is at its ${edge} (${fmt(distance > 0 ? range.max : range.min, 1)} mm)`);
  }
  const limitedSpeed = Math.min(speed, jogSpeedLimit(state, axis));
  const notes: string[] = [];
  if (Math.abs(delta) < Math.abs(distance) - 0.0005) {
    notes.push(`Limited to ${fmt(Math.abs(delta), 2)} mm by the ${axisLabel(axis)} travel limit`);
  }
  if (limitedSpeed < speed) notes.push(`Speed limited to ${fmt(limitedSpeed, 1)} mm/s`);

  return gcodeScript(
    ['SAVE_GCODE_STATE NAME=layr_jog', 'G91', `G1 ${axisLabel(axis)}${fmt(delta)} F${Math.round(limitedSpeed * 60)}`, 'RESTORE_GCODE_STATE NAME=layr_jog'],
    `Move ${axisLabel(axis)} ${delta > 0 ? '+' : ''}${fmt(delta, 2)} mm`,
    'motion',
    (Math.abs(delta) / limitedSpeed) * SECOND + 30 * SECOND,
    {
      note: notes.length ? notes.join('. ') : null,
      settled: (s) => {
        const p = s.toolhead?.position;
        return !!p && Math.abs(p[i]! - target) < 0.01;
      },
    },
  );
}

function prepareTemperature(state: PrinterState, heater: string, target: number): Prepared {
  const reading = heaterReadings(state).find((h) => h.object === heater);
  if (!reading) return fail('This heater is not available');
  if (!Number.isFinite(target)) return fail('Enter a temperature');
  const value = Math.round(target);
  const limits = heaterLimitsFor(state, heater);
  if (value < 0) return fail('Temperature cannot be negative');
  if (value !== 0 && (value < limits.minTemp || value > limits.maxTemp)) {
    return fail(`${reading.label} accepts 0 or ${fmt(limits.minTemp, 0)}–${fmt(limits.maxTemp, 0)} °C`);
  }
  let confirm: Confirmation | null = null;
  const high = HIGH_TEMP_CONFIRM[heaterKind(heater)];
  if (value >= high) {
    confirm = {
      title: `Heat ${reading.label} to ${value} °C?`,
      body: `This is at or above ${high} °C. Make sure the hardware and filament are rated for it.`,
      confirmLabel: `Heat to ${value} °C`,
      tone: 'warn',
    };
  } else if (jobActive(state) && value !== Math.round(reading.target ?? 0)) {
    confirm = {
      title: `Change ${reading.label} during the print?`,
      body: `The target changes from ${Math.round(reading.target ?? 0)} °C to ${value} °C while a print is ${isPaused(state) ? 'paused' : 'running'}.`,
      confirmLabel: 'Change temperature',
      tone: 'warn',
    };
  }
  return gcodeScript(
    [`SET_HEATER_TEMPERATURE HEATER=${heaterArgument(heater)} TARGET=${value}`],
    value === 0 ? `Turn off ${reading.label}` : `Set ${reading.label} to ${value} °C`,
    `temp:${heater}`,
    10 * SECOND,
    { confirm },
  );
}

function prepareExtrude(state: PrinterState, length: number, speed: number): Prepared {
  if (isPrinting(state)) return fail('Not available while printing. Pause first');
  if (!state.extruder) return fail('No extruder reported');
  if (!Number.isFinite(length) || length === 0) return fail('Choose a length');
  const maxLength = Math.min(state.limits.extruder.maxExtrudeOnlyDistance, MAX_EXTRUDE_MM);
  if (Math.abs(length) > maxLength) return fail(`Limited to ${fmt(maxLength, 0)} mm per move`);
  if (!Number.isFinite(speed) || speed <= 0) return fail('Choose a speed');
  const minTemp = state.limits.extruder.minExtrudeTemp;
  const temp = state.extruder.temperature;
  if (state.canExtrude === false || temp === null || temp < minTemp) {
    return fail(`Nozzle is below ${fmt(minTemp, 0)} °C. Heat it before extruding`);
  }
  const maxSpeed = Math.min(state.limits.extruder.maxExtrudeOnlyVelocity ?? MAX_EXTRUDE_SPEED, MAX_EXTRUDE_SPEED);
  const limitedSpeed = Math.min(speed, maxSpeed);
  const verb = length > 0 ? 'Extrude' : 'Retract';
  return gcodeScript(
    ['SAVE_GCODE_STATE NAME=layr_extrude', 'M83', `G1 E${fmt(length)} F${Math.round(limitedSpeed * 60)}`, 'RESTORE_GCODE_STATE NAME=layr_extrude'],
    `${verb} ${fmt(Math.abs(length), 1)} mm`,
    'extrude',
    (Math.abs(length) / limitedSpeed) * SECOND + 30 * SECOND,
    { note: limitedSpeed < speed ? `Speed limited to ${fmt(limitedSpeed, 1)} mm/s` : null },
  );
}

function prepareFan(state: PrinterState, fanName: string, speed: number): Prepared {
  const fan = state.fans.find((f) => f.object === fanName);
  if (!fan) return fail('This fan is not available');
  if (!fan.controllable) return fail(`${fan.label} is controlled automatically by Klipper`);
  if (!Number.isFinite(speed)) return fail('Choose a speed');
  const value = Math.min(1, Math.max(0, speed));
  const pct = Math.round(value * 100);
  const line =
    fan.object === 'fan'
      ? value === 0
        ? 'M107'
        : `M106 S${Math.round(value * 255)}`
      : `SET_FAN_SPEED FAN=${objectSuffix(fan.object)} SPEED=${fmt(value, 2)}`;
  return gcodeScript([line], `${fan.label} ${pct === 0 ? 'off' : `${pct}%`}`, `fan:${fan.object}`, 10 * SECOND);
}

function prepareLight(state: PrinterState, lightName: string, value: number): Prepared {
  const light = state.lights.find((l) => l.object === lightName);
  if (!light) return fail('This light is not available');
  if (!Number.isFinite(value)) return fail('Choose a brightness');
  let v = Math.min(1, Math.max(0, value));
  if (!light.dimmable) v = v >= 0.5 ? 1 : 0;
  const name = objectSuffix(light.object);
  const line =
    light.kind === 'pin'
      ? `SET_PIN PIN=${name} VALUE=${fmt(v * light.scale)}`
      : `SET_LED LED=${name} RED=${fmt(v)} GREEN=${fmt(v)} BLUE=${fmt(v)} WHITE=${fmt(v)}`;
  const pct = Math.round(v * 100);
  return gcodeScript([line], `${light.label} ${pct === 0 ? 'off' : light.dimmable ? `${pct}%` : 'on'}`, `light:${light.object}`, 10 * SECOND);
}

function prepareMacro(state: PrinterState, name: string): Prepared {
  const macro = state.macros.find((m) => m.name === name);
  if (!macro || !MACRO_NAME_RE.test(name)) return fail('This macro is not available');
  if (macro.requiredParams.length > 0) {
    return fail(`${name} needs ${macro.requiredParams.join(', ')}. Open it in the console to enter values`);
  }
  const body = [
    macro.description ?? 'Runs this macro from your Klipper configuration.',
    jobActive(state) ? 'A print is in progress.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return gcodeScript([name], `Run ${name}`, `macro:${name}`, MACRO_TIMEOUT_MS, {
    confirm: { title: `Run ${name}?`, body, confirmLabel: 'Run macro', tone: jobActive(state) ? 'warn' : 'primary' },
  });
}

/** Normalises console input to one line, or explains why it cannot be sent. */
export function normaliseConsoleInput(script: string): { ok: true; line: string } | { ok: false; message: string } {
  const line = script.trim();
  if (!line) return { ok: false, message: 'Type a command' };
  if (/[\r\n]/.test(line)) return { ok: false, message: 'Send one command at a time' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(line)) return { ok: false, message: 'The command contains control characters' };
  if (line.length > MAX_CONSOLE_LENGTH) return { ok: false, message: `Commands are limited to ${MAX_CONSOLE_LENGTH} characters` };
  return { ok: true, line };
}

function prepareConsole(state: PrinterState, script: string): Prepared {
  const normalised = normaliseConsoleInput(script);
  if (!normalised.ok) return fail(normalised.message);
  const line = normalised.line;
  const command = line.split(/\s+/)[0]!.toUpperCase();

  // Moonraker docs: M112 sent as G-code waits in the queue; use the emergency stop endpoint instead.
  if (command === 'M112') return prepareCommand({ kind: 'emergency_stop' }, state);

  const gate = state.klippy === 'ready' ? readyGate(state) : hostGate(state);
  if (gate) return fail(gate);
  const risky = RISKY_GCODE_RE.test(line);
  const notes = [
    risky ? 'This command can move, reset or reconfigure the printer.' : '',
    jobActive(state) ? 'A print is in progress.' : '',
    'LAYR sends it exactly as typed.',
  ].filter(Boolean);
  return gcodeScript([line], line, 'console', CONSOLE_TIMEOUT_MS, {
    confirm: { title: 'Send this command?', body: notes.join(' '), confirmLabel: 'Send', tone: risky || jobActive(state) ? 'warn' : 'primary' },
  });
}

function validFilePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Extra facts that do not live on `PrinterState` (Spoolman is not a Klipper object). */
export interface CommandContext {
  spoolman: SpoolmanFacts | null;
  /** Names from `printer.gcode.help`, once read. Null until that list has arrived. */
  gcodeCommands: ReadonlySet<string> | null;
}

export const EMPTY_COMMAND_CONTEXT: CommandContext = { spoolman: null, gcodeCommands: null };

/** Decides whether `command` may run in `state`, and how. Never performs I/O. */
export function prepareCommand(command: PrinterCommand, state: PrinterState, context: CommandContext = EMPTY_COMMAND_CONTEXT): Prepared {
  switch (command.kind) {
    case 'emergency_stop': {
      const gate = hostGate(state);
      if (gate) return fail(gate);
      // The deliberate press-and-hold in the UI is the confirmation; a dialog would only delay a real emergency.
      return ok({ method: 'printer.emergency_stop', summary: 'Emergency stop', group: ESTOP_GROUP, timeoutMs: 10 * SECOND });
    }
    case 'firmware_restart':
    case 'restart': {
      const gate = hostGate(state);
      if (gate) return fail(gate);
      const firmware = command.kind === 'firmware_restart';
      return ok({
        method: firmware ? 'printer.firmware_restart' : 'printer.restart',
        summary: firmware ? 'Firmware restart' : 'Restart Klipper',
        group: 'restart',
        timeoutMs: 30 * SECOND,
        confirm: {
          title: firmware ? 'Restart firmware?' : 'Restart Klipper?',
          body: `${firmware ? 'Resets every MCU and reloads the configuration.' : 'Reloads the Klipper configuration on the host.'} Heaters turn off, axes need homing and any print in progress is lost.`,
          confirmLabel: firmware ? 'Firmware restart' : 'Restart',
          tone: jobActive(state) ? 'danger' : 'warn',
        },
      });
    }
    case 'delete_file': {
      if (state.status === 'unconfigured' || state.transport !== 'connected') return fail('Printer is offline');
      if (!validFilePath(command.path)) return fail('Invalid file path');
      if (jobActive(state) && state.job?.filename === command.path) return fail('This file is being printed');
      return ok({
        method: 'server.files.delete_file',
        params: { path: `gcodes/${command.path}` },
        summary: `Delete ${command.path.split('/').pop()}`,
        group: `file:${command.path}`,
        timeoutMs: 15 * SECOND,
        confirm: {
          title: 'Delete this file?',
          body: `${command.path} will be removed from the printer. This cannot be undone.`,
          confirmLabel: 'Delete',
          tone: 'danger',
        },
      });
    }
    case 'gcode':
      return prepareConsole(state, command.script);
  }

  const gate = readyGate(state);
  if (gate) return fail(gate);

  switch (command.kind) {
    case 'pause':
      if (!isPrinting(state)) return fail('No print is running');
      return ok({ method: 'printer.print.pause', summary: 'Pause print', group: 'print', timeoutMs: 60 * SECOND });
    case 'resume':
      if (!isPaused(state)) return fail('The print is not paused');
      return ok({ method: 'printer.print.resume', summary: 'Resume print', group: 'print', timeoutMs: 60 * SECOND });
    case 'cancel':
      if (!jobActive(state)) return fail('No print is running');
      return ok({
        method: 'printer.print.cancel',
        summary: 'Cancel print',
        group: 'print',
        timeoutMs: 120 * SECOND,
        confirm: {
          title: 'Cancel this print?',
          body: `${state.job?.filename ?? 'The current job'} will stop and cannot be resumed.`,
          confirmLabel: 'Cancel print',
          cancelLabel: 'Keep printing',
          tone: 'danger',
        },
      });
    case 'start_print':
      if (jobActive(state)) return fail('A print is already in progress');
      if (!validFilePath(command.filename)) return fail('Invalid file path');
      return ok({
        method: 'printer.print.start',
        params: { filename: command.filename },
        summary: `Start ${command.filename.split('/').pop()}`,
        group: 'print',
        timeoutMs: 60 * SECOND,
        confirm: {
          title: 'Start this print?',
          body: `${command.filename} will start now. Check that the bed is clear and the right filament is loaded.`,
          confirmLabel: 'Start print',
          tone: 'primary',
        },
      });
    case 'home': {
      if (jobActive(state)) return fail('Not available during a print');
      const axes = AXES.filter((a) => command.axes.includes(a));
      const onlyZ = axes.length > 0 && axes.every((a) => a === 'z');
      if (onlyZ && !(isHomed(state, 'x') && isHomed(state, 'y'))) return fail('Home X and Y first, or use Home all');
      const args = axes.length === 0 || axes.length === 3 ? '' : ` ${axes.map(axisLabel).join(' ')}`;
      return gcodeScript([`G28${args}`], args ? `Home${args}` : 'Home all axes', 'motion', 180 * SECOND);
    }
    case 'jog':
      if (jobActive(state)) return fail('Not available during a print');
      return prepareJog(state, command.axis, command.distance, command.speed);
    case 'motors_off':
      if (jobActive(state)) return fail('Not available during a print');
      return gcodeScript(['M84'], 'Disable motors', 'motion', 10 * SECOND, {
        confirm: {
          title: 'Disable stepper motors?',
          body: 'All axes will need homing again before they can be moved.',
          confirmLabel: 'Disable motors',
          tone: 'warn',
        },
      });
    case 'set_speed_factor':
      return feedrateOverride('M220', 'Speed override', command.percent);
    case 'set_extrude_factor':
      return feedrateOverride('M221', 'Flow override', command.percent);
    case 'z_offset': {
      const delta = command.delta;
      if (!Number.isFinite(delta) || delta === 0) return fail('Choose a step');
      if (Math.abs(delta) > MAX_Z_OFFSET_STEP) return fail(`Steps are limited to ${MAX_Z_OFFSET_STEP} mm`);
      if (!isHomed(state, 'z')) return fail('Home Z first');
      const next = (state.toolhead?.zOffset ?? 0) + delta;
      if (Math.abs(next) > MAX_Z_OFFSET_TOTAL) return fail(`Z offset is limited to ±${MAX_Z_OFFSET_TOTAL} mm`);
      return gcodeScript([`SET_GCODE_OFFSET Z_ADJUST=${fmt(delta)} MOVE=1`], `Z offset ${delta > 0 ? '+' : ''}${fmt(delta)} mm`, 'zoffset', 30 * SECOND);
    }
    case 'extrude':
      return prepareExtrude(state, command.length, command.speed);
    case 'set_temperature':
      return prepareTemperature(state, command.heater, command.target);
    case 'set_fan':
      return prepareFan(state, command.fan, command.speed);
    case 'set_light':
      return prepareLight(state, command.light, command.value);
    case 'macro':
      return prepareMacro(state, command.name);
    case 'set_active_spool':
    case 'clear_active_spool':
    case 'unload_for_spool_clear':
      return prepareSpoolmanCommand(command, state, context.spoolman);
  }
}
