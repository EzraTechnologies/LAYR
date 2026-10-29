import type { RawStatus } from '../moonraker/types';
import type { MmuGate, MmuSnapshot, MmuUnit } from './types';

const HEX_RE = /^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const OBJECTS = ['mmu', 'mmu_machine'] as const;

export function isMmuObject(name: string): boolean {
  return name === 'mmu' || name === 'mmu_machine';
}

/** The two Happy Hare status objects. Stepper and LED objects are left alone. */
export function mmuSubscriptionObjects(available: readonly string[]): string[] {
  return OBJECTS.filter((name) => available.includes(name));
}

/** Null when this printer has no Happy Hare objects. */
export function mapMmu(raw: RawStatus, objects: readonly string[]): MmuSnapshot | null {
  const known = new Set([...objects, ...Object.keys(raw)].filter(isMmuObject));
  if (known.size === 0) return null;
  const root = asRecord(raw.mmu);
  const machine = asRecord(raw.mmu_machine);
  const units = mapUnits(machine);
  const numGates = integer(root.num_gates) ?? integer(machine.num_gates) ?? listLength(root);
  const ttgMap = intList(root.ttg_map);
  const gates = numGates === null ? [] : Array.from({ length: Math.min(numGates, 32) }, (_, index) => mapGate(root, index, units, ttgMap));
  const active = asRecord(root.active_filament);
  return {
    enabled: bool(root.enabled),
    version: text(machine.happy_hare_version),
    numGates,
    homed: bool(root.is_homed),
    printState: text(root.print_state),
    tool: integer(root.tool),
    gate: integer(root.gate),
    filament: text(root.filament),
    action: text(root.action),
    operation: text(root.operation),
    reasonForPause: text(root.reason_for_pause),
    hasBypass: bypass(root.has_bypass, machine),
    ttgMap,
    activeName: text(active.filament_name),
    activeMaterial: text(active.material),
    units,
    gates,
  };
}

/** Documented gate_status codes. Anything else is shown as the number Happy Hare sent. */
export function gateStatusLabel(status: number | null): string | null {
  if (status === null) return null;
  if (status === -1) return 'Unknown';
  if (status === 0) return 'Empty';
  if (status === 1) return 'Available';
  if (status === 2) return 'Buffered';
  return `Status ${status}`;
}

export function toolForGate(ttgMap: readonly number[] | null, gate: number): number | null {
  if (!Number.isInteger(gate) || gate < 0) return null;
  if (!ttgMap) return gate;
  const tool = ttgMap.indexOf(gate);
  return tool >= 0 ? tool : null;
}

function mapGate(root: Record<string, unknown>, index: number, units: MmuUnit[], ttgMap: number[] | null): MmuGate {
  const color = gateColor(at(root.gate_color_rgb, index), at(root.gate_td1_color, index), at(root.gate_color, index));
  const spool = integer(at(root.gate_spool_id, index));
  const temperature = integer(at(root.gate_temperature, index));
  return {
    index,
    tool: toolForGate(ttgMap, index),
    unit: units.find((unit) => index >= unit.firstGate && index < unit.firstGate + unit.gateCount)?.name ?? null,
    filamentName: text(at(root.gate_filament_name, index)),
    material: text(at(root.gate_material, index)),
    color: color.css,
    colorName: color.name,
    status: integer(at(root.gate_status, index)),
    spoolId: spool !== null && spool >= 0 ? spool : null,
    temperatureC: temperature !== null && temperature >= 0 ? temperature : null,
  };
}

function mapUnits(machine: Record<string, unknown>): MmuUnit[] {
  return Object.keys(machine)
    .filter((key) => /^unit_\d+$/.test(key))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((key) => {
      const unit = asRecord(machine[key]);
      const name = text(unit.display_name) ?? text(unit.name);
      const firstGate = integer(unit.first_gate);
      const gateCount = integer(unit.num_gates);
      if (!name || firstGate === null || firstGate < 0 || gateCount === null || gateCount <= 0) return null;
      return { name, firstGate, gateCount };
    })
    .filter((unit): unit is MmuUnit => unit !== null);
}

function bypass(value: unknown, machine: Record<string, unknown>): boolean | null {
  const direct = bool(value);
  if (direct !== null) return direct;
  const flags = Object.keys(machine)
    .filter((key) => /^unit_\d+$/.test(key))
    .map((key) => bool(asRecord(machine[key]).has_bypass))
    .filter((flag): flag is boolean => flag !== null);
  if (flags.length === 0) return null;
  return flags.some(Boolean);
}

function gateColor(rgb: unknown, hex: unknown, name: unknown): { css: string | null; name: string | null } {
  const fromRgb = rgbCss(rgb);
  if (fromRgb) return { css: fromRgb, name: null };
  if (typeof hex === 'string' && HEX_RE.test(hex.trim())) {
    const trimmed = hex.trim();
    const body = trimmed.startsWith('#') ? trimmed.slice(1, 7) : trimmed.slice(0, 6);
    return { css: `#${body.toLowerCase()}`, name: null };
  }
  return { css: null, name: text(name) };
}

function rgbCss(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const channels = value.slice(0, 3).map((channel) => (typeof channel === 'number' ? channel : Number.NaN));
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  const bytes = channels.map((channel) => (channel <= 1 ? Math.round(channel * 255) : Math.round(channel)));
  if (bytes.some((channel) => channel < 0 || channel > 255)) return null;
  return `#${bytes.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function listLength(root: Record<string, unknown>): number | null {
  const lists = [root.gate_status, root.gate_material, root.gate_filament_name, root.ttg_map].filter(Array.isArray) as unknown[][];
  if (lists.length === 0) return null;
  return Math.max(...lists.map((list) => list.length));
}

function at(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
}

function intList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.map(integer);
  if (numbers.some((item) => item === null)) return null;
  return numbers as number[];
}
