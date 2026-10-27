import { describe, expect, it } from 'vitest';
import type { ConfigSettings, RawStatus } from '../src/lib/moonraker/types';
import {
  filamentCrossSectionAreaMm2,
  filamentDiameterMm,
  mapMotion,
  quantizeFlowMm3S,
  quantizeSpeedMmS,
  volumetricFlowMm3PerS,
} from '../src/lib/printer/telemetry';

const area175 = filamentCrossSectionAreaMm2(1.75);
const area285 = filamentCrossSectionAreaMm2(2.85);

describe('volumetric flow math', () => {
  it('uses π r² and keeps the sign of the extruder velocity', () => {
    expect(area175).toBeCloseTo(Math.PI * 0.875 * 0.875, 10);
    expect(volumetricFlowMm3PerS(5, 1.75)).toBeCloseTo(5 * area175, 10);
    expect(volumetricFlowMm3PerS(-4, 1.75)).toBeCloseTo(-4 * area175, 10);
    expect(volumetricFlowMm3PerS(0, 2.85)).toBe(0);
    expect(volumetricFlowMm3PerS(1, 2.85)).toBeCloseTo(area285, 10);
  });

  it('quantizes so sub-unit jitter does not change the displayed value', () => {
    expect(quantizeSpeedMmS(48.2)).toBe(48);
    expect(quantizeSpeedMmS(48.4)).toBe(48);
    expect(quantizeFlowMm3S(12.026)).toBe(12);
    expect(quantizeFlowMm3S(12.049)).toBe(12);
    expect(quantizeFlowMm3S(-0.04)).toBe(0);
  });
});

describe('mapMotion', () => {
  const settings = (diameter: unknown, section = 'extruder'): ConfigSettings => ({
    [section]: { filament_diameter: diameter },
  });

  function motion(raw: RawStatus, config: ConfigSettings = settings('1.75')) {
    return mapMotion(raw, config);
  }

  it('maps live velocity and volumetric flow from motion_report', () => {
    const reading = motion({
      motion_report: { live_velocity: 48.2, live_extruder_velocity: 5 },
      toolhead: { extruder: 'extruder' },
      gcode_move: { speed_factor: 1.5, extrude_factor: 0.8 },
    });
    expect(reading.speedMmS).toBe(48);
    expect(reading.flowMm3S).toBe(quantizeFlowMm3S(volumetricFlowMm3PerS(5, 1.75)));
    expect(reading.flowGap).toBeNull();
    expect(reading.speedMmS).not.toBe(150);
    expect(String(reading.flowMm3S)).not.toContain('%');
  });

  it('does not substitute speed_factor or extrude_factor when motion_report is missing', () => {
    const reading = motion({
      gcode_move: { speed_factor: 2, extrude_factor: 1.25 },
      toolhead: { max_velocity: 300 },
    });
    expect(reading).toMatchObject({ speedMmS: null, flowMm3S: null, flowGap: 'velocity' });
  });

  it('uses the active extruder diameter, including a non-default string value', () => {
    const reading = motion(
      {
        motion_report: { live_velocity: 20, live_extruder_velocity: 1 },
        toolhead: { extruder: 'extruder1' },
      },
      { extruder: { filament_diameter: '1.75' }, extruder1: { filament_diameter: '2.85' } },
    );
    expect(reading.filamentDiameterMm).toBe(2.85);
    expect(reading.flowMm3S).toBe(quantizeFlowMm3S(volumetricFlowMm3PerS(1, 2.85)));
    expect(reading.flowMm3S).not.toBe(quantizeFlowMm3S(volumetricFlowMm3PerS(1, 1.75)));
  });

  it('reports halted extrusion as zero and retraction as negative flow', () => {
    expect(motion({ motion_report: { live_velocity: 0, live_extruder_velocity: 0 } })).toMatchObject({
      speedMmS: 0,
      flowMm3S: 0,
      flowGap: null,
    });
    const retract = motion({ motion_report: { live_velocity: 30, live_extruder_velocity: -4 } });
    expect(retract.speedMmS).toBe(30);
    expect(retract.flowMm3S).toBeLessThan(0);
    expect(retract.flowMm3S).toBe(quantizeFlowMm3S(volumetricFlowMm3PerS(-4, 1.75)));
  });

  it('leaves flow unavailable when the diameter is missing or nonsense, without inventing 1.75', () => {
    expect(motion({ motion_report: { live_velocity: 10, live_extruder_velocity: 2 } }, {})).toMatchObject({
      speedMmS: 10,
      flowMm3S: null,
      flowGap: 'diameter',
    });
    for (const diameter of ['0', 'nope', '  ', 0, -1, 12]) {
      expect(filamentDiameterMm(settings(diameter), 'extruder')).toBeNull();
    }
    expect(filamentDiameterMm(settings(' 1.75 '), 'extruder')).toBe(1.75);
  });

  it('does not keep a value when the report object disappears', () => {
    expect(motion({})).toMatchObject({ speedMmS: null, flowMm3S: null, flowGap: 'velocity' });
  });
});
