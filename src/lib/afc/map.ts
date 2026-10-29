import type { RawStatus } from '../moonraker/types';
import type { AfcLane, AfcSnapshot } from './types';

const HEX_RE = /^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const LANE_PREFIXES = ['AFC_lane ', 'AFC_stepper '];

export function isAfcObject(name: string): boolean {
  return name === 'AFC' || name.startsWith('AFC_');
}

/** Prefer the main object and lanes. Capped so a huge config cannot flood the socket. */
export function afcSubscriptionObjects(available: readonly string[], cap = 40): string[] {
  const score = (name: string) => {
    if (name === 'AFC') return 0;
    if (LANE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 1;
    if (name.startsWith('AFC_hub ') || name.startsWith('AFC_extruder ') || name.startsWith('AFC_buffer ')) return 2;
    return 3;
  };
  return available
    .filter(isAfcObject)
    .sort((a, b) => score(a) - score(b) || a.localeCompare(b))
    .slice(0, cap);
}

/** Null when this printer has no AFC objects. Present printers still return a snapshot if fields are missing. */
export function mapAfc(raw: RawStatus, objects: readonly string[]): AfcSnapshot | null {
  const known = new Set([...objects, ...Object.keys(raw)].filter(isAfcObject));
  if (known.size === 0) return null;
  const root = asRecord(raw.AFC);
  const fromObjects = [...known].filter((name) => LANE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  const named = stringList(root.lanes) ?? [];
  const lanes: AfcLane[] = [];
  const seen = new Set<string>();
  for (const objectName of fromObjects.sort()) {
    const lane = mapLane(objectName, asRecord(raw[objectName]));
    if (!lane || seen.has(lane.name)) continue;
    seen.add(lane.name);
    lanes.push(lane);
  }
  for (const name of named) {
    if (seen.has(name)) continue;
    seen.add(name);
    lanes.push(emptyLane(name));
  }
  lanes.sort((a, b) => (a.index ?? 999) - (b.index ?? 999) || a.name.localeCompare(b.name));
  const message = afcMessage(root.message);
  return {
    currentLoad: text(root.current_load),
    currentState: text(root.current_state),
    error: typeof root.error_state === 'boolean' ? root.error_state : null,
    bypass: typeof root.bypass_state === 'boolean' ? root.bypass_state : null,
    message: message.text,
    messageTone: message.tone,
    units: stringList(root.units) ?? [],
    hubs: stringList(root.hubs) ?? [],
    buffers: stringList(root.buffers) ?? [],
    extruders: stringList(root.extruders) ?? [],
    lanes,
  };
}

function mapLane(objectName: string, fields: Record<string, unknown>): AfcLane | null {
  const fallback = objectName.includes(' ') ? objectName.slice(objectName.indexOf(' ') + 1) : '';
  const name = text(fields.name) ?? (fallback || null);
  if (!name) return null;
  const color = colorFields(fields.color);
  return {
    name,
    object: objectName,
    unit: text(fields.unit),
    hub: text(fields.hub),
    index: integer(fields.lane),
    map: text(fields.map),
    material: text(fields.material),
    color: color.css,
    colorName: color.name,
    weightG: grams(fields.weight),
    filamentStatus: text(fields.filament_status),
    load: bool(fields.load),
    prep: bool(fields.prep),
    toolLoaded: bool(fields.tool_loaded),
    loadedToHub: bool(fields.loaded_to_hub),
    spoolId: integer(fields.spool_id),
    runoutLane: text(fields.runout_lane),
  };
}

function emptyLane(name: string): AfcLane {
  return {
    name,
    object: null,
    unit: null,
    hub: null,
    index: null,
    map: null,
    material: null,
    color: null,
    colorName: null,
    weightG: null,
    filamentStatus: null,
    load: null,
    prep: null,
    toolLoaded: null,
    loadedToHub: null,
    spoolId: null,
    runoutLane: null,
  };
}

function colorFields(value: unknown): { css: string | null; name: string | null } {
  if (typeof value !== 'string') return { css: null, name: null };
  const trimmed = value.trim();
  if (!trimmed) return { css: null, name: null };
  if (!HEX_RE.test(trimmed)) return { css: null, name: trimmed };
  const hex = trimmed.startsWith('#') ? trimmed.slice(1, 7) : trimmed.slice(0, 6);
  return { css: `#${hex.toLowerCase()}`, name: null };
}

function afcMessage(value: unknown): { text: string | null; tone: string | null } {
  if (typeof value === 'string') return { text: value.trim() || null, tone: null };
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const record = value as Record<string, unknown>;
    const textValue = text(record.message);
    const tone = typeof record.type === 'string' ? record.type : null;
    return { text: textValue, tone };
  }
  return { text: null, tone: null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
}

function grams(value: unknown): number | null {
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}
