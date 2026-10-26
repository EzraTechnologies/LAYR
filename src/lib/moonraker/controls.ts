import {
  FALLBACK_LIMITS,
  type FanReading,
  type FilamentSensor,
  type HeaterLimits,
  type LightControl,
  type MacroInfo,
  type PrinterLimits,
  type ToolheadInfo,
} from '../printer/model';
import { toNumber } from './mapping';
import { FAN_PREFIXES, FILAMENT_SENSOR_PREFIXES, humanize, isFanObject, isLightObject, macroObjects, objectSuffix } from './objects';
import type { ConfigSettings, RawStatus } from './types';

function vector(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length < length) return null;
  const out = value.slice(0, length).map(toNumber);
  return out.every((v) => v !== null) ? (out as number[]) : null;
}

export function mapToolhead(raw: RawStatus): ToolheadInfo | null {
  const toolhead = raw.toolhead;
  if (!toolhead) return null;
  const move = raw.gcode_move ?? {};
  const origin = vector(move.homing_origin, 3);
  return {
    homedAxes: typeof toolhead.homed_axes === 'string' ? toolhead.homed_axes.toLowerCase() : '',
    position: vector(toolhead.position, 4) as ToolheadInfo['position'],
    axisMin: vector(toolhead.axis_minimum, 3) as ToolheadInfo['axisMin'],
    axisMax: vector(toolhead.axis_maximum, 3) as ToolheadInfo['axisMax'],
    maxVelocity: toNumber(toolhead.max_velocity),
    zOffset: origin ? Math.round(origin[2]! * 1000) / 1000 : null,
    speedFactor: toNumber(move.speed_factor),
    extrudeFactor: toNumber(move.extrude_factor),
  };
}

function fanLabel(name: string): string {
  if (name === 'fan') return 'Part cooling';
  return humanize(objectSuffix(name));
}

export function mapFans(raw: RawStatus): FanReading[] {
  const names = Object.keys(raw).filter(isFanObject);
  // Part cooling fan first, then controllable fans, then automatic ones.
  const rank = (n: string) => (n === 'fan' ? 0 : n.startsWith('fan_generic ') ? 1 : 2);
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return names.map((name) => {
    const prefix = Object.keys(FAN_PREFIXES).find((p) => name.startsWith(p));
    const speed = toNumber(raw[name]!.speed);
    return {
      object: name,
      label: fanLabel(name),
      speed: speed === null ? null : Math.min(1, Math.max(0, speed)),
      rpm: toNumber(raw[name]!.rpm),
      controllable: name === 'fan' || (prefix ? FAN_PREFIXES[prefix]!.controllable : false),
    };
  });
}

function truthy(value: unknown): boolean {
  return value === true || value === 'True' || value === 'true' || value === 1;
}

export function mapLights(raw: RawStatus, settings: ConfigSettings): LightControl[] {
  return Object.keys(raw)
    .filter(isLightObject)
    .sort()
    .map((name) => {
      const status = raw[name]!;
      const section = settings[name.toLowerCase()] ?? {};
      if (name.startsWith('output_pin ')) {
        const value = toNumber(status.value);
        const scale = toNumber(section.scale) ?? 1;
        return {
          object: name,
          label: humanize(objectSuffix(name)),
          kind: 'pin' as const,
          value: value === null ? null : Math.min(1, Math.max(0, value)),
          dimmable: truthy(section.pwm),
          scale: scale > 0 ? scale : 1,
        };
      }
      const colors = Array.isArray(status.color_data) ? (status.color_data as unknown[]) : [];
      const first = Array.isArray(colors[0]) ? (colors[0] as unknown[]).map(toNumber) : [];
      const channels = first.filter((v): v is number => v !== null);
      return {
        object: name,
        label: humanize(objectSuffix(name)),
        kind: 'led' as const,
        value: channels.length ? Math.max(...channels) : null,
        dimmable: true,
        scale: 1,
      };
    });
}

const PARAM_RES = [/params\.([A-Za-z_][A-Za-z0-9_]*)/g, /params\[\s*['"]([^'"]+)['"]\s*\]/g];
const DEFAULT_FILTER_RE = /^\s*\|\s*default\b/;

export interface MacroParamScan {
  params: string[];
  /**
   * Parameters used without a `|default(...)` filter or an `is defined` / `in params` guard. Klipper renders a
   * missing parameter as empty or 0, which can turn e.g. a temperature into 0, so these must be provided.
   * This is a heuristic over the template text, not a Jinja parser.
   */
  required: string[];
}

export function scanMacroParams(template: unknown): MacroParamScan {
  if (typeof template !== 'string') return { params: [], required: [] };
  const optional = new Set<string>();
  const found = new Set<string>();
  for (const re of PARAM_RES) {
    for (const match of template.matchAll(re)) {
      const name = match[1]!.toUpperCase();
      found.add(name);
      const after = template.slice(match.index! + match[0].length);
      if (DEFAULT_FILTER_RE.test(after) || /^\s+is\s+defined/.test(after)) optional.add(name);
    }
  }
  for (const match of template.matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s+in\s+params\b/g)) {
    optional.add(match[1]!.toUpperCase());
  }
  const params = [...found].sort();
  return { params, required: params.filter((p) => !optional.has(p)) };
}

/** Names of `params.X` references in a macro template, upper case and de-duplicated. */
export function macroParams(template: unknown): string[] {
  return scanMacroParams(template).params;
}

export function mapMacros(objects: readonly string[], settings: ConfigSettings): MacroInfo[] {
  return macroObjects(objects)
    .map((object) => {
      const name = objectSuffix(object).toUpperCase();
      const section = settings[object.toLowerCase()] ?? {};
      const description = typeof section.description === 'string' ? section.description.trim() : '';
      const scan = scanMacroParams(section.gcode);
      return {
        name,
        // Klipper's default description is "G-Code macro"; it carries no information.
        description: description && description !== 'G-Code macro' ? description : null,
        params: scan.params,
        requiredParams: scan.required,
        hidden: name.startsWith('_'),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mapFilamentSensors(raw: RawStatus): FilamentSensor[] {
  return Object.keys(raw)
    .filter((n) => FILAMENT_SENSOR_PREFIXES.some((p) => n.startsWith(p)))
    .sort()
    .map((name) => ({
      object: name,
      label: humanize(objectSuffix(name)),
      detected: typeof raw[name]!.filament_detected === 'boolean' ? (raw[name]!.filament_detected as boolean) : null,
      enabled: typeof raw[name]!.enabled === 'boolean' ? (raw[name]!.enabled as boolean) : null,
    }));
}

function heaterLimits(section: Record<string, unknown> | undefined, fallback: HeaterLimits | null): HeaterLimits | null {
  const max = toNumber(section?.max_temp);
  if (max === null) return fallback;
  return { minTemp: toNumber(section?.min_temp) ?? 0, maxTemp: max };
}

/** Limits from `configfile.settings`, falling back to conservative defaults when the config is unavailable. */
export function mapLimits(settings: ConfigSettings): PrinterLimits {
  const extruder = settings.extruder;
  const fromConfig = !!extruder && toNumber(extruder.max_temp) !== null;
  if (!fromConfig) return structuredClone(FALLBACK_LIMITS);

  const heaters: Record<string, HeaterLimits> = {};
  for (const [section, values] of Object.entries(settings)) {
    if (!section.startsWith('heater_generic ')) continue;
    const limits = heaterLimits(values, null);
    if (limits) heaters[section] = limits;
  }
  const printer = settings.printer ?? {};
  return {
    fromConfig: true,
    extruder: {
      ...heaterLimits(extruder, FALLBACK_LIMITS.extruder)!,
      minExtrudeTemp: toNumber(extruder.min_extrude_temp) ?? FALLBACK_LIMITS.extruder.minExtrudeTemp,
      maxExtrudeOnlyDistance: toNumber(extruder.max_extrude_only_distance) ?? FALLBACK_LIMITS.extruder.maxExtrudeOnlyDistance,
      maxExtrudeOnlyVelocity: toNumber(extruder.max_extrude_only_velocity),
    },
    bed: heaterLimits(settings.heater_bed, null),
    heaters,
    maxVelocity: toNumber(printer.max_velocity),
    maxZVelocity: toNumber(printer.max_z_velocity),
  };
}
