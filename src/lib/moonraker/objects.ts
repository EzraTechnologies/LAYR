/**
 * Klipper objects LAYR subscribes to, and the fields requested from each.
 * Requesting explicit fields (instead of `null` = everything) keeps WebSocket traffic and UI updates low.
 */

import { integrationEnabled, linkStatusSubscription } from '../integrations/runtime';

/** Happy Hare objects are added or dropped when its Settings switch changes. */
linkStatusSubscription();

export const CORE_OBJECTS: Record<string, string[]> = {
  webhooks: ['state', 'state_message'],
  print_stats: ['filename', 'state', 'message', 'print_duration', 'total_duration', 'filament_used', 'info'],
  display_status: ['progress', 'message'],
  virtual_sdcard: ['progress', 'is_active', 'file_path'],
  extruder: ['temperature', 'target', 'power', 'can_extrude'],
  heater_bed: ['temperature', 'target', 'power'],
  toolhead: ['homed_axes', 'position', 'axis_minimum', 'axis_maximum', 'max_velocity', 'extruder'],
  gcode_move: ['homing_origin', 'speed_factor', 'extrude_factor'],
  idle_timeout: ['state'],
};

/** Objects that are subscribed when present but are not reported as missing. */
const OPTIONAL_OBJECTS: Record<string, string[]> = {
  fan: ['speed', 'rpm'],
};

/**
 * Live speed/flow and the parsed printer config.
 * `configfile.settings` is large, but filament diameter lives there and the subscription has to
 * include it (a separate query remains only as a fallback when the snapshot omits the field).
 * `motion_report` is limited to the two live velocities so stepper/trapq dumps are not streamed.
 */
const TELEMETRY_OBJECTS: Record<string, string[]> = {
  motion_report: ['live_velocity', 'live_extruder_velocity'],
  configfile: ['settings'],
};

const HEATER_FIELDS = ['temperature', 'target', 'power'];
const SENSOR_FIELDS = ['temperature'];
const FAN_FIELDS = ['speed', 'rpm'];

/** Object name prefixes for optional temperature sources discovered via `printer.objects.list`. */
export const OPTIONAL_PREFIXES: Record<string, string[]> = {
  'temperature_sensor ': SENSOR_FIELDS,
  'temperature_fan ': ['temperature', 'target', 'speed'],
  'heater_generic ': HEATER_FIELDS,
};

export const FAN_PREFIXES: Record<string, { controllable: boolean }> = {
  'fan_generic ': { controllable: true },
  'heater_fan ': { controllable: false },
  'controller_fan ': { controllable: false },
};

export const LED_PREFIXES = ['led ', 'neopixel ', 'dotstar ', 'pca9533 ', 'pca9632 '] as const;
export const FILAMENT_SENSOR_PREFIXES = ['filament_switch_sensor ', 'filament_motion_sensor '] as const;

/**
 * Happy Hare `mmu` status keys this UI reads.
 * Klipper returns null for a key the running Happy Hare build does not publish
 * (`webhooks` uses `dict.get`), so an older build still subscribes.
 * `filament_pos` is the state-machine integer. Current Happy Hare also publishes
 * `filament_position` as a bowden distance in millimetres; some older builds used
 * that name for the integer. The parser accepts an in-range integer from either.
 */
export const MMU_FIELDS = [
  'enabled',
  'num_gates',
  'is_homed',
  'print_state',
  'tool',
  'gate',
  'last_tool',
  'next_tool',
  'filament',
  'filament_pos',
  'filament_position',
  'action',
  'reason_for_pause',
  'is_paused',
  'is_locked',
  'ttg_map',
  'gate_status',
  'gate_filament_name',
  'gate_material',
  'gate_color',
  'gate_color_rgb',
  'gate_temperature',
  'gate_spool_id',
  'active_filament',
] as const;

/**
 * `output_pin` objects can drive anything (beepers, relays, heaters on some machines), so only pins whose names
 * look like lighting are offered as light controls.
 */
export const LIGHT_PIN_RE = /(light|led|lamp|lighting|lights)/i;

/** Cap optional sensors so a printer with many probes cannot flood the display. */
export const MAX_OPTIONAL_SENSORS = 8;
const MAX_FANS = 8;
const MAX_LIGHTS = 6;

export interface SubscriptionPlan {
  objects: Record<string, string[]>;
  /** Core objects that this printer does not provide. */
  missing: string[];
}

function startsWithAny(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => name.startsWith(p));
}

export function isLightObject(name: string): boolean {
  if (startsWithAny(name, LED_PREFIXES)) return true;
  return name.startsWith('output_pin ') && LIGHT_PIN_RE.test(objectSuffix(name));
}

export function isFanObject(name: string): boolean {
  return name === 'fan' || Object.keys(FAN_PREFIXES).some((p) => name.startsWith(p));
}

/**
 * Builds the subscription for the objects a printer actually exposes.
 * Unknown objects are never subscribed to, so a minimal Klipper config does not cause errors.
 */
export function planSubscription(available: readonly string[]): SubscriptionPlan {
  const availableSet = new Set(available);
  const objects: Record<string, string[]> = {};
  const missing: string[] = [];

  for (const [name, fields] of Object.entries(CORE_OBJECTS)) {
    if (availableSet.has(name)) objects[name] = fields;
    else missing.push(name);
  }
  for (const [name, fields] of Object.entries(OPTIONAL_OBJECTS)) {
    if (availableSet.has(name)) objects[name] = fields;
  }
  for (const [name, fields] of Object.entries(TELEMETRY_OBJECTS)) {
    if (availableSet.has(name)) objects[name] = fields;
  }

  const optional: Array<[string, string[]]> = [];
  for (const name of available) {
    const prefix = Object.keys(OPTIONAL_PREFIXES).find((p) => name.startsWith(p));
    if (prefix) optional.push([name, OPTIONAL_PREFIXES[prefix]!]);
  }
  // Chamber sensors are shown on the dashboard, so they must survive the cap.
  optional.sort(([a], [b]) => Number(isChamberObject(b)) - Number(isChamberObject(a)));
  for (const [name, fields] of optional.slice(0, MAX_OPTIONAL_SENSORS)) {
    objects[name] = fields;
  }

  available.filter((n) => n !== 'fan' && isFanObject(n)).slice(0, MAX_FANS).forEach((n) => (objects[n] = FAN_FIELDS));
  for (const name of available.filter(isLightObject).slice(0, MAX_LIGHTS)) {
    objects[name] = name.startsWith('output_pin ') ? ['value'] : ['color_data'];
  }
  for (const name of available.filter((n) => startsWithAny(n, FILAMENT_SENSOR_PREFIXES))) {
    objects[name] = ['filament_detected', 'enabled'];
  }

  // Exact Klipper object name, and only after the user turns Happy Hare on.
  // AFC and other MMU objects are not Happy Hare and are left untouched.
  if (availableSet.has('mmu') && integrationEnabled('happyHare')) objects.mmu = [...MMU_FIELDS];

  return { objects, missing };
}

/** `gcode_macro NAME` objects, as listed by `printer.objects.list`. */
export function macroObjects(available: readonly string[]): string[] {
  return available.filter((n) => n.startsWith('gcode_macro '));
}

/** Returns the user-facing part of an object name: `temperature_sensor chamber` → `chamber`. */
export function objectSuffix(name: string): string {
  const space = name.indexOf(' ');
  return space === -1 ? name : name.slice(space + 1);
}

export function isChamberObject(name: string): boolean {
  return name.includes(' ') && objectSuffix(name).toLowerCase().includes('chamber');
}

/** Turns `nevermore_fan` / `case-light` into `Nevermore fan` / `Case light`. */
export function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
