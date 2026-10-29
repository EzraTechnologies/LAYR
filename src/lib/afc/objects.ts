/**
 * Klipper objects published by AFC-Klipper-Add-On (extras/AFC.py and the unit/lane modules).
 * Subscriptions stay empty unless `printer.objects.list` contains `AFC`, so a printer without
 * the add-on is unchanged. Fields match `get_status` on those objects. Unknown modules
 * (`mmu`, loggers, config writers) are not subscribed.
 */

/** `load_config` in extras/AFC.py. */
export const AFC_OBJECT = 'AFC';

/**
 * Lane sections. Current configs use `[AFC_lane name]`. Older installs use `[AFC_stepper name]`.
 * Both classes expose `AFCLane.get_status`.
 */
export const AFC_LANE_PREFIXES = ['AFC_lane ', 'AFC_stepper '] as const;

/**
 * Unit sections that subclass `afcUnit` (or, for OAMS, expose their own `get_status`).
 * The object name is the module filename plus the config name.
 */
export const AFC_UNIT_PREFIXES = [
  'AFC_BoxTurtle ',
  'AFC_NightOwl ',
  'AFC_HTLF ',
  'AFC_QuattroBox ',
  'AFC_Claymore ',
  'AFC_EMU ',
  'AFC_OAMS ',
  'AFC_OpenAMS ',
  'AFC_Toolchanger ',
  'AFC_vivid ',
] as const;

/** Fields from `afc.get_status` that the screen reads. */
export const AFC_STATUS_FIELDS = [
  'current_load',
  'current_lane',
  'next_lane',
  'current_state',
  'current_toolchange',
  'number_of_toolchanges',
  'error_state',
  'bypass_state',
  'position_saved',
  'units',
  'lanes',
  'extruders',
  'hubs',
  'buffers',
  'message',
] as const;

/** Fields from `AFCLane.get_status` used for the lane card. Calibration and TD-1 blobs are left out. */
export const AFC_LANE_FIELDS = [
  'name',
  'unit',
  'hub',
  'extruder',
  'buffer',
  'buffer_status',
  'lane',
  'map',
  'load',
  'prep',
  'tool_loaded',
  'loaded_to_hub',
  'material',
  'filament_name',
  'color',
  'weight',
  'spool_id',
  'filament_status',
  'status',
  'runout_lane',
] as const;

/** Fields from `afcUnit.get_status`. */
export const AFC_UNIT_FIELDS = ['lanes', 'extruders', 'hubs', 'buffers'] as const;

/** Commands registered by extras/AFC.py. Sent only when `printer.gcode.help` lists them. */
export const AFC_COMMANDS = ['TOOL_LOAD', 'TOOL_UNLOAD', 'CHANGE_TOOL', 'HUB_LOAD', 'LANE_UNLOAD'] as const;

export type AfcCommandName = (typeof AFC_COMMANDS)[number];

/** Enough for several Box Turtles. Beyond this, extra objects are not subscribed. */
export const MAX_AFC_LANES = 32;
export const MAX_AFC_UNITS = 8;

/** Lane names that can be placed after `LANE=` without changing the G-code. */
export const AFC_LANE_NAME = /^[A-Za-z0-9_-]{1,32}$/;

export interface AfcSubscription {
  objects: Record<string, string[]>;
  truncated: boolean;
}

function withPrefix(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix));
}

/**
 * Objects to add to the printer subscription when AFC is installed.
 * Returns an empty plan when `AFC` itself is not in the object list.
 */
export function afcSubscription(available: readonly string[]): AfcSubscription {
  if (!available.includes(AFC_OBJECT)) return { objects: {}, truncated: false };

  const objects: Record<string, string[]> = { [AFC_OBJECT]: [...AFC_STATUS_FIELDS] };
  const lanes = available.filter((name) => withPrefix(name, AFC_LANE_PREFIXES));
  const units = available.filter((name) => withPrefix(name, AFC_UNIT_PREFIXES));
  for (const name of lanes.slice(0, MAX_AFC_LANES)) objects[name] = [...AFC_LANE_FIELDS];
  for (const name of units.slice(0, MAX_AFC_UNITS)) objects[name] = [...AFC_UNIT_FIELDS];
  return { objects, truncated: lanes.length > MAX_AFC_LANES || units.length > MAX_AFC_UNITS };
}

/** `printer.gcode.help` result → the documented AFC commands that Klipper actually registered. */
export function afcCommandsFromHelp(result: unknown): AfcCommandName[] {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return [];
  const help = result as Record<string, unknown>;
  return AFC_COMMANDS.filter((name) => typeof help[name] === 'string');
}
