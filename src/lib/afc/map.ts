import { humanize } from '../moonraker/objects';
import type { RawStatus } from '../moonraker/types';
import {
  AFC_COMMANDS,
  AFC_LANE_NAME,
  AFC_LANE_PREFIXES,
  AFC_OBJECT,
  AFC_UNIT_PREFIXES,
  afcSubscription,
} from './objects';
import type { AfcLane, AfcLaneGroup, AfcMessage, AfcStatus, AfcUnit } from './types';

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAP_RE = /^[A-Za-z0-9_-]{1,16}$/;
const LANE_DETAIL_KEYS = new Set([
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
]);

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  for (const item of value) {
    const text = cleanText(item, 64);
    if (text) names.push(text);
  }
  return names;
}

function laneToken(value: unknown): string | null {
  const text = cleanText(value, 32);
  return text && AFC_LANE_NAME.test(text) ? text : null;
}

/** `current_load` is null when nothing is loaded. A non-empty value that is not a lane name is unknown. */
function loadName(status: Record<string, unknown> | undefined, key: string): { known: boolean; name: string | null } {
  if (!status || !Object.prototype.hasOwnProperty.call(status, key)) return { known: false, name: null };
  const value = status[key];
  if (value === null) return { known: true, name: null };
  const name = laneToken(value);
  return name ? { known: true, name } : { known: false, name: null };
}

function colorOrNull(value: unknown): string | null {
  return typeof value === 'string' && COLOR_RE.test(value.trim()) ? value.trim() : null;
}

function weightOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000) return null;
  return value;
}

function spoolOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 1_000_000) return null;
  return value;
}

function indexOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 999) return null;
  return value;
}

function mapMessage(value: unknown): AfcMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = cleanText(record.message, 240);
  if (!text) return null;
  return { text, type: cleanText(record.type, 32)?.toLowerCase() ?? '' };
}

function toolchange(status: Record<string, unknown>): { current: number; total: number } | null {
  const current = status.current_toolchange;
  const total = status.number_of_toolchanges;
  if (typeof current !== 'number' || typeof total !== 'number') return null;
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0 || current < 0) return null;
  return { current: Math.floor(current), total: Math.floor(total) };
}

interface LaneDraft {
  name: string;
  object: string | null;
  detail: Record<string, unknown> | null;
}

function prefixOf(name: string, prefixes: readonly string[]): string | null {
  return prefixes.find((prefix) => name.startsWith(prefix)) ?? null;
}

function parseLane(draft: LaneDraft): AfcLane {
  const detail = draft.detail;
  const known = !!detail && Object.keys(detail).some((key) => LANE_DETAIL_KEYS.has(key));
  const read = (key: string) => (known && detail ? detail[key] : undefined);
  return {
    name: draft.name,
    object: draft.object,
    detailReported: known,
    unit: cleanText(read('unit'), 64),
    hub: cleanText(read('hub'), 64),
    extruder: cleanText(read('extruder'), 64),
    buffer: cleanText(read('buffer'), 64),
    bufferStatus: cleanText(read('buffer_status'), 40),
    index: indexOrNull(read('lane')),
    map: (() => {
      const text = cleanText(read('map'), 16);
      return text && MAP_RE.test(text) ? text : null;
    })(),
    load: boolOrNull(read('load')),
    prep: boolOrNull(read('prep')),
    toolLoaded: boolOrNull(read('tool_loaded')),
    loadedToHub: boolOrNull(read('loaded_to_hub')),
    material: cleanText(read('material'), 40),
    filamentName: cleanText(read('filament_name'), 80),
    color: colorOrNull(read('color')),
    weight: weightOrNull(read('weight')),
    spoolId: spoolOrNull(read('spool_id')),
    filamentStatus: cleanText(read('filament_status'), 40),
    status: cleanText(read('status'), 40),
    runoutLane: laneToken(read('runout_lane')),
  };
}

function unitFromLabel(label: string): { typeLabel: string | null; name: string } {
  const space = label.indexOf(' ');
  if (space === -1) return { typeLabel: null, name: label };
  const type = label.slice(0, space).trim();
  const name = label.slice(space + 1).trim();
  return { typeLabel: type ? humanize(type) : null, name: name || label };
}

function parseUnits(status: Record<string, unknown> | undefined, raw: RawStatus, objects: readonly string[]): AfcUnit[] {
  const byName = new Map<string, AfcUnit>();
  const labels = stringList(status?.units) ?? [];
  for (const label of labels) {
    const parsed = unitFromLabel(label);
    if (!parsed.name || byName.has(parsed.name)) continue;
    byName.set(parsed.name, { name: parsed.name, typeLabel: parsed.typeLabel, object: null, laneNames: [] });
  }

  for (const objectName of objects) {
    const prefix = prefixOf(objectName, AFC_UNIT_PREFIXES);
    if (!prefix) continue;
    const name = objectName.slice(prefix.length).trim();
    if (!name) continue;
    const fields = raw[objectName];
    const laneNames = stringList(fields?.lanes) ?? [];
    const existing = byName.get(name);
    if (existing) {
      existing.object = objectName;
      if (laneNames.length > 0) existing.laneNames = laneNames;
      if (!existing.typeLabel) existing.typeLabel = humanize(prefix.trim().replace(/^AFC_/, ''));
      continue;
    }
    // A unit object that did not report lanes, and that the AFC object did not list, is not shown as an empty unit.
    if (laneNames.length === 0) continue;
    byName.set(name, {
      name,
      typeLabel: humanize(prefix.trim().replace(/^AFC_/, '')),
      object: objectName,
      laneNames,
    });
  }
  return [...byName.values()];
}

function parseLanes(status: Record<string, unknown> | undefined, raw: RawStatus, objects: readonly string[]): AfcLane[] {
  const byName = new Map<string, LaneDraft>();
  const laneObjects = objects.filter((name) => prefixOf(name, AFC_LANE_PREFIXES));
  // `AFC_lane` wins when an install still has both objects for one name.
  const ordered = [
    ...laneObjects.filter((name) => name.startsWith('AFC_lane ')),
    ...laneObjects.filter((name) => name.startsWith('AFC_stepper ')),
  ];
  for (const objectName of ordered) {
    const prefix = prefixOf(objectName, AFC_LANE_PREFIXES)!;
    const name = objectName.slice(prefix.length).trim();
    if (!AFC_LANE_NAME.test(name) || byName.has(name)) continue;
    const fields = raw[objectName];
    const detail = fields && Object.keys(fields).length > 0 ? fields : null;
    byName.set(name, { name, object: objectName, detail });
  }

  const listed = stringList(status?.lanes);
  if (listed) {
    for (const name of listed) {
      if (!AFC_LANE_NAME.test(name) || byName.has(name)) continue;
      byName.set(name, { name, object: null, detail: null });
    }
    const lanes = listed.filter((name) => AFC_LANE_NAME.test(name)).map((name) => parseLane(byName.get(name)!));
    for (const [name, draft] of byName) {
      if (!listed.includes(name)) lanes.push(parseLane(draft));
    }
    return lanes;
  }
  return [...byName.values()].map(parseLane);
}

/**
 * Builds the AFC screen model from a status snapshot.
 * Returns null when the printer's object list has no `AFC` object.
 */
export function mapAfc(raw: RawStatus, objects: readonly string[], commands: readonly string[]): AfcStatus | null {
  if (!objects.includes(AFC_OBJECT)) return null;
  const status = raw[AFC_OBJECT];
  const reported = !!status && Object.keys(status).length > 0;
  const loaded = loadName(status, 'current_load');
  const allowed = new Set<string>(commands);
  return {
    reported,
    state: cleanText(status?.current_state, 40),
    error: boolOrNull(status?.error_state),
    currentLoad: loaded.name,
    currentLoadKnown: loaded.known,
    currentLane: laneToken(status?.current_lane),
    nextLane: laneToken(status?.next_lane),
    bypass: boolOrNull(status?.bypass_state),
    positionSaved: status?.position_saved === true ? true : status?.position_saved === false ? false : null,
    toolchange: status ? toolchange(status) : null,
    message: mapMessage(status?.message),
    units: parseUnits(status, raw, objects),
    lanes: parseLanes(status, raw, objects),
    commands: AFC_COMMANDS.filter((name) => allowed.has(name)),
    truncated: afcSubscription(objects).truncated,
  };
}

/** Lanes grouped under the units AFC reported. Lanes with no matching unit stay in a final group. */
export function groupAfcLanes(afc: AfcStatus): AfcLaneGroup[] {
  const used = new Set<string>();
  const groups: AfcLaneGroup[] = [];
  for (const unit of afc.units) {
    const named = new Set(unit.laneNames);
    const lanes = afc.lanes.filter((lane) => !used.has(lane.name) && (named.has(lane.name) || lane.unit === unit.name));
    for (const lane of lanes) used.add(lane.name);
    const ordered = [
      ...unit.laneNames.map((name) => lanes.find((lane) => lane.name === name)).filter((lane): lane is AfcLane => !!lane),
      ...lanes.filter((lane) => !unit.laneNames.includes(lane.name)),
    ];
    const title = unit.typeLabel ? `${unit.typeLabel} · ${unit.name}` : unit.name;
    groups.push({ id: unit.name, title, lanes: ordered });
  }
  const rest = afc.lanes.filter((lane) => !used.has(lane.name));
  if (rest.length > 0) {
    groups.push({ id: afc.units.length === 0 ? 'lanes' : 'other', title: afc.units.length === 0 ? 'Lanes' : 'Other lanes', lanes: rest });
  }
  return groups;
}
