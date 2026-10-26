/**
 * Klipper objects LAYR subscribes to, and the fields requested from each.
 * Requesting explicit fields (instead of `null` = everything) keeps WebSocket traffic and UI updates low.
 */

export const CORE_OBJECTS: Record<string, string[]> = {
  webhooks: ['state', 'state_message'],
  print_stats: ['filename', 'state', 'message', 'print_duration', 'total_duration', 'filament_used', 'info'],
  display_status: ['progress', 'message'],
  virtual_sdcard: ['progress', 'is_active', 'file_path'],
  extruder: ['temperature', 'target', 'power'],
  heater_bed: ['temperature', 'target', 'power'],
};

const HEATER_FIELDS = ['temperature', 'target', 'power'];
const SENSOR_FIELDS = ['temperature'];

/** Object name prefixes for optional temperature sources discovered via `printer.objects.list`. */
export const OPTIONAL_PREFIXES: Record<string, string[]> = {
  'temperature_sensor ': SENSOR_FIELDS,
  'temperature_fan ': ['temperature', 'target', 'speed'],
  'heater_generic ': HEATER_FIELDS,
};

/** Cap optional sensors so a printer with many probes cannot flood the display. */
export const MAX_OPTIONAL_SENSORS = 8;

export interface SubscriptionPlan {
  objects: Record<string, string[]>;
  /** Core objects that this printer does not provide. */
  missing: string[];
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

  return { objects, missing };
}

/** Returns the user-facing part of an object name: `temperature_sensor chamber` → `chamber`. */
export function objectSuffix(name: string): string {
  const space = name.indexOf(' ');
  return space === -1 ? name : name.slice(space + 1);
}

export function isChamberObject(name: string): boolean {
  return name.includes(' ') && objectSuffix(name).toLowerCase().includes('chamber');
}
