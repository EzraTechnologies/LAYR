import type { ConfigSettings, RawStatus } from '../moonraker/types';
import type { MotionTelemetry } from './model';

/** Klipper `configfile.settings` values are strings. Numbers are accepted too. */
export function configNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Realistic filament diameters. Anything else is treated as unconfigured. */
const DIAMETER_MIN_MM = 0.5;
const DIAMETER_MAX_MM = 5;

/**
 * Cross-section of a round filament, mm².
 * `π × (diameter / 2)²`.
 */
export function filamentCrossSectionAreaMm2(diameterMm: number): number {
  const radius = diameterMm / 2;
  return Math.PI * radius * radius;
}

/**
 * Volumetric flow in mm³/s from filament feed rate (mm/s) and diameter (mm).
 * Negative feed rate (retraction) produces a negative flow. This is not an extrude-factor percentage.
 */
export function volumetricFlowMm3PerS(extruderVelocityMmS: number, diameterMm: number): number {
  return extruderVelocityMmS * filamentCrossSectionAreaMm2(diameterMm);
}

/** Whole millimetres per second. Sub-mm jitter must not repaint the dashboard. */
export function quantizeSpeedMmS(mmPerS: number): number {
  return Math.round(mmPerS);
}

/** One decimal place, mm³/s. */
export function quantizeFlowMm3S(mm3PerS: number): number {
  const quantized = Math.round(mm3PerS * 10) / 10;
  return Object.is(quantized, -0) ? 0 : quantized;
}

/**
 * Filament diameter for the extruder Klipper says is active (`toolhead.extruder`),
 * or `extruder` when that field is absent. Does not fall back to a different tool.
 */
export function filamentDiameterMm(settings: ConfigSettings, activeExtruder: unknown): number | null {
  const name =
    typeof activeExtruder === 'string' && activeExtruder.trim() !== '' ? activeExtruder.trim().toLowerCase() : 'extruder';
  const diameter = configNumber(settings[name]?.filament_diameter);
  if (diameter === null || diameter < DIAMETER_MIN_MM || diameter > DIAMETER_MAX_MM) return null;
  return diameter;
}

/**
 * Live toolhead speed and volumetric flow from Klipper's `motion_report`.
 * `gcode_move.speed_factor` and `extrude_factor` are intentionally ignored: they are
 * override multipliers, not the mm/s and mm³/s shown on the dashboard.
 */
export function mapMotion(raw: RawStatus, settings: ConfigSettings): MotionTelemetry {
  const report = raw.motion_report;
  const speedRaw = report ? configNumber(report.live_velocity) : null;
  const extrudeRaw = report ? configNumber(report.live_extruder_velocity) : null;
  // `live_velocity` is a magnitude. A negative sample is not a direction.
  const speedMmS = speedRaw === null ? null : quantizeSpeedMmS(Math.max(0, speedRaw));
  const diameter = filamentDiameterMm(settings, raw.toolhead?.extruder);

  if (extrudeRaw === null) {
    return { speedMmS, flowMm3S: null, filamentDiameterMm: diameter, flowGap: 'velocity' };
  }
  if (diameter === null) {
    return { speedMmS, flowMm3S: null, filamentDiameterMm: null, flowGap: 'diameter' };
  }
  return {
    speedMmS,
    flowMm3S: quantizeFlowMm3S(volumetricFlowMm3PerS(extrudeRaw, diameter)),
    filamentDiameterMm: diameter,
    flowGap: null,
  };
}
