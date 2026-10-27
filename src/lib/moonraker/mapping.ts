import type { HeaterReading, JobInfo, JobState, KlippyState } from '../printer/model';
import { isChamberObject, objectSuffix } from './objects';
import type { RawStatus } from './types';

const JOB_STATES: readonly JobState[] = ['standby', 'printing', 'paused', 'complete', 'cancelled', 'error'];
const KLIPPY_STATES: readonly KlippyState[] = ['ready', 'startup', 'shutdown', 'error', 'disconnected'];

/** Below this progress the progress-based estimate is too noisy; prefer the slicer estimate. */
const PROGRESS_ESTIMATE_MIN = 0.05;

export function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseKlippyState(value: unknown): KlippyState {
  return KLIPPY_STATES.includes(value as KlippyState) ? (value as KlippyState) : 'unknown';
}

export function parseJobState(value: unknown): JobState {
  return JOB_STATES.includes(value as JobState) ? (value as JobState) : 'unknown';
}

/**
 * Merges a `notify_status_update` diff into the accumulated status in place.
 * Moonraker only sends changed fields; nested dicts such as `print_stats.info` are merged one level deep.
 */
export function mergeStatus(target: RawStatus, diff: unknown): RawStatus {
  if (!isPlainObject(diff)) return target;
  for (const [objectName, fields] of Object.entries(diff)) {
    if (!isPlainObject(fields)) continue;
    const current = (target[objectName] ??= {});
    for (const [field, value] of Object.entries(fields)) {
      const existing = current[field];
      current[field] = isPlainObject(value) && isPlainObject(existing) ? { ...existing, ...value } : value;
    }
  }
  return target;
}

function clamp01(value: number | null): number | null {
  return value === null ? null : Math.min(1, Math.max(0, value));
}

/** Maps `print_stats`, `display_status` and `virtual_sdcard` to a job, or null when no job is loaded. */
export function mapJob(raw: RawStatus, slicerEstimate: number | null = null): JobInfo | null {
  const stats = raw.print_stats;
  if (!stats) return null;

  const state = parseJobState(stats.state);
  const filename = toText(stats.filename);
  if (!filename) return null;

  const display = raw.display_status ?? {};
  const sdcard = raw.virtual_sdcard ?? {};
  let progress = clamp01(toNumber(display.progress) ?? toNumber(sdcard.progress));
  if (state === 'complete') progress = 1;

  const printDuration = toNumber(stats.print_duration);
  const totalDuration = toNumber(stats.total_duration);
  const info = isPlainObject(stats.info) ? stats.info : {};

  let remaining: number | null = null;
  let remainingSource: JobInfo['remainingSource'] = null;
  if (state === 'printing' || state === 'paused') {
    const estimate = estimateRemaining(progress, printDuration, slicerEstimate);
    remaining = estimate.remaining;
    remainingSource = estimate.source;
  }

  return {
    filename,
    state,
    progress,
    printDuration,
    totalDuration,
    remaining,
    remainingSource,
    currentLayer: toNumber(info.current_layer),
    totalLayers: toNumber(info.total_layer),
    filamentUsed: toNumber(stats.filament_used),
    message: toText(stats.message) ?? toText(display.message),
    thumbnailPath: null,
  };
}

export function estimateRemaining(
  progress: number | null,
  printDuration: number | null,
  slicerEstimate: number | null,
): { remaining: number | null; source: JobInfo['remainingSource'] } {
  const elapsed = printDuration ?? 0;
  const hasProgress = progress !== null && progress > 0 && elapsed > 0;

  if (hasProgress && progress >= PROGRESS_ESTIMATE_MIN) {
    return { remaining: Math.max(0, elapsed / progress - elapsed), source: 'progress' };
  }
  if (slicerEstimate !== null && slicerEstimate > 0) {
    return { remaining: Math.max(0, slicerEstimate - elapsed), source: 'slicer' };
  }
  if (hasProgress && progress >= 0.01) {
    return { remaining: Math.max(0, elapsed / progress - elapsed), source: 'progress' };
  }
  return { remaining: null, source: null };
}

function labelFor(objectName: string): string {
  if (objectName === 'extruder') return 'Nozzle';
  if (objectName === 'heater_bed') return 'Bed';
  if (isChamberObject(objectName)) return 'Chamber';
  const words = objectSuffix(objectName).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/** Maps a heater or sensor object. Returns null if the object is not present in the status. */
export function mapHeater(raw: RawStatus, objectName: string): HeaterReading | null {
  const obj = raw[objectName];
  if (!obj) return null;
  const isSensor = objectName.startsWith('temperature_sensor ');
  return {
    object: objectName,
    label: labelFor(objectName),
    temperature: round1(toNumber(obj.temperature)),
    target: isSensor ? null : round1(toNumber(obj.target)),
    power: isSensor ? null : clamp01(toNumber(obj.power)),
  };
}

export interface TemperatureSet {
  extruder: HeaterReading | null;
  bed: HeaterReading | null;
  chamber: HeaterReading | null;
  sensors: HeaterReading[];
}

const OPTIONAL_PREFIX_RE = /^(temperature_sensor|temperature_fan|heater_generic) /;

export function mapTemperatures(raw: RawStatus): TemperatureSet {
  let chamber: HeaterReading | null = null;
  const sensors: HeaterReading[] = [];

  for (const name of Object.keys(raw).sort()) {
    if (!OPTIONAL_PREFIX_RE.test(name)) continue;
    const reading = mapHeater(raw, name);
    if (!reading) continue;
    if (!chamber && isChamberObject(name)) chamber = reading;
    else sensors.push(reading);
  }

  return {
    extruder: mapHeater(raw, 'extruder'),
    bed: mapHeater(raw, 'heater_bed'),
    chamber,
    sensors,
  };
}
