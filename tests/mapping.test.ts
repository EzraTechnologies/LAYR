import { describe, expect, it } from 'vitest';
import {
  estimateRemaining,
  mapJob,
  mapTemperatures,
  mergeStatus,
  parseJobState,
  parseKlippyState,
} from '../src/lib/moonraker/mapping';
import { planSubscription, MAX_OPTIONAL_SENSORS } from '../src/lib/moonraker/objects';
import type { RawStatus } from '../src/lib/moonraker/types';
import { assembleState, type AssembleInputs } from '../src/lib/printer/assemble';

describe('mergeStatus', () => {
  it('merges partial diffs per object and one level into nested dicts', () => {
    const raw: RawStatus = {
      print_stats: { state: 'printing', info: { current_layer: 1, total_layer: 10 } },
    };
    mergeStatus(raw, { print_stats: { info: { current_layer: 2 } }, extruder: { temperature: 200 } });
    expect(raw).toEqual({
      print_stats: { state: 'printing', info: { current_layer: 2, total_layer: 10 } },
      extruder: { temperature: 200 },
    });
  });

  it('ignores malformed diffs', () => {
    const raw: RawStatus = {};
    mergeStatus(raw, null);
    mergeStatus(raw, [1, 2]);
    mergeStatus(raw, { extruder: 5 });
    expect(raw).toEqual({});
  });
});

describe('state parsing', () => {
  it('maps unknown values to unknown', () => {
    expect(parseKlippyState('ready')).toBe('ready');
    expect(parseKlippyState('banana')).toBe('unknown');
    expect(parseJobState('paused')).toBe('paused');
    expect(parseJobState(undefined)).toBe('unknown');
  });
});

describe('mapJob', () => {
  const printing: RawStatus = {
    print_stats: {
      filename: 'parts/bracket.gcode',
      state: 'printing',
      message: '',
      print_duration: 600,
      total_duration: 660,
      filament_used: 1234.5,
      info: { current_layer: 5, total_layer: 50 },
    },
    display_status: { progress: 0.25, message: null },
    virtual_sdcard: { progress: 0.2 },
  };

  it('maps print_stats and display_status', () => {
    expect(mapJob(printing)).toEqual({
      filename: 'parts/bracket.gcode',
      state: 'printing',
      progress: 0.25,
      printDuration: 600,
      totalDuration: 660,
      remaining: 1800,
      remainingSource: 'progress',
      currentLayer: 5,
      totalLayers: 50,
      filamentUsed: 1234.5,
      message: null,
      thumbnailPath: null,
    });
  });

  it('falls back to virtual_sdcard progress when display_status is missing', () => {
    const { display_status: _omit, ...raw } = printing;
    expect(mapJob(raw)?.progress).toBe(0.2);
  });

  it('returns null without print_stats or without a filename', () => {
    expect(mapJob({})).toBeNull();
    expect(mapJob({ print_stats: { state: 'standby', filename: '' } })).toBeNull();
  });

  it('reports complete jobs at 100% without a remaining estimate', () => {
    const job = mapJob({ print_stats: { filename: 'a.gcode', state: 'complete', print_duration: 100 } });
    expect(job).toMatchObject({ progress: 1, remaining: null, state: 'complete' });
  });

  it('does not invent values for missing fields', () => {
    const job = mapJob({ print_stats: { filename: 'a.gcode', state: 'printing' } });
    expect(job).toMatchObject({
      progress: null,
      printDuration: null,
      remaining: null,
      currentLayer: null,
      totalLayers: null,
      filamentUsed: null,
    });
  });

  it('clamps out-of-range progress', () => {
    expect(mapJob({ print_stats: { filename: 'a', state: 'printing' }, display_status: { progress: 1.7 } })?.progress).toBe(1);
  });
});

describe('estimateRemaining', () => {
  it('prefers the slicer estimate early in a print', () => {
    expect(estimateRemaining(0.02, 60, 3600)).toEqual({ remaining: 3540, source: 'slicer' });
  });
  it('uses progress once it is meaningful', () => {
    expect(estimateRemaining(0.5, 1000, 3600)).toEqual({ remaining: 1000, source: 'progress' });
  });
  it('returns null when there is nothing to estimate from', () => {
    expect(estimateRemaining(null, null, null)).toEqual({ remaining: null, source: null });
    expect(estimateRemaining(0, 0, null)).toEqual({ remaining: null, source: null });
  });
});

describe('mapTemperatures', () => {
  it('maps heaters, detects a chamber and keeps other sensors', () => {
    const temps = mapTemperatures({
      extruder: { temperature: 210.04, target: 210, power: 0.5 },
      heater_bed: { temperature: 60, target: 60, power: 1.4 },
      'temperature_sensor chamber_air': { temperature: 35.55 },
      'temperature_sensor mcu_temp': { temperature: 45 },
      'heater_generic enclosure_heater': { temperature: 40, target: 45, power: 0.3 },
    });
    expect(temps.extruder).toEqual({ object: 'extruder', label: 'Nozzle', temperature: 210, target: 210, power: 0.5 });
    expect(temps.bed?.power).toBe(1);
    expect(temps.chamber).toEqual({
      object: 'temperature_sensor chamber_air',
      label: 'Chamber',
      temperature: 35.6,
      target: null,
      power: null,
    });
    expect(temps.sensors.map((s) => s.label)).toEqual(['Enclosure heater', 'Mcu temp']);
  });

  it('returns nulls when heaters are missing', () => {
    expect(mapTemperatures({})).toEqual({ extruder: null, bed: null, chamber: null, sensors: [] });
  });
});

describe('planSubscription', () => {
  it('reports missing core objects and caps optional sensors, keeping the chamber', () => {
    const sensors = Array.from({ length: 12 }, (_, i) => `temperature_sensor probe_${i}`);
    const plan = planSubscription(['extruder', 'print_stats', ...sensors, 'temperature_fan chamber']);
    expect(plan.missing).toEqual([
      'webhooks',
      'display_status',
      'virtual_sdcard',
      'heater_bed',
      'toolhead',
      'gcode_move',
      'idle_timeout',
    ]);
    const optional = Object.keys(plan.objects).filter((k) => k.includes(' '));
    expect(optional).toHaveLength(MAX_OPTIONAL_SENSORS);
    expect(optional).toContain('temperature_fan chamber');
  });

  it('subscribes to motion_report velocities and configfile settings when the printer has them', () => {
    const plan = planSubscription(['motion_report', 'configfile', 'extruder', 'webhooks', 'print_stats', 'display_status', 'virtual_sdcard', 'heater_bed', 'toolhead', 'gcode_move', 'idle_timeout']);
    expect(plan.objects.motion_report).toEqual(['live_velocity', 'live_extruder_velocity']);
    expect(plan.objects.configfile).toEqual(['settings']);
    expect(plan.missing).toEqual([]);
    expect(plan.objects.motion_report).not.toContain('trapq');
  });
});

describe('assembleState', () => {
  const base: AssembleInputs = {
    printerId: 'p1',
    configuredName: '',
    hostname: 'voron',
    transport: 'connected',
    klippy: 'ready',
    klippyMessage: null,
    reconnectAttempt: 0,
    nextRetryAt: null,
    transportReason: null,
    raw: {
      print_stats: { filename: 'x.gcode', state: 'paused', print_duration: 10 },
      extruder: { temperature: 200, target: 200, power: 0.2 },
    },
    slicerEstimate: null,
    missingObjects: ['heater_bed'],
    objects: ['extruder', 'print_stats'],
    afcCommands: [],
    settings: {},
    thumbnailPath: null,
    now: 0,
  };

  it('uses the host name when no display name is configured', () => {
    expect(assembleState(base).printerName).toBe('voron');
    expect(assembleState({ ...base, configuredName: 'Workshop' }).printerName).toBe('Workshop');
  });

  it('derives the paused status from print_stats', () => {
    expect(assembleState(base).status).toBe('paused');
  });

  it('hides stale object data when Klipper is not ready', () => {
    const state = assembleState({
      ...base,
      klippy: 'shutdown',
      klippyMessage: 'MCU shutdown',
      raw: {
        ...base.raw,
        motion_report: { live_velocity: 80, live_extruder_velocity: 4 },
        gcode_move: { speed_factor: 2, extrude_factor: 1.5 },
      },
      settings: { extruder: { filament_diameter: '1.75' } },
    });
    expect(state).toMatchObject({
      status: 'error',
      statusDetail: 'MCU shutdown',
      job: null,
      extruder: null,
      missingObjects: [],
      motion: { speedMmS: null, flowMm3S: null },
    });
  });

  it('describes a pending retry', () => {
    const state = assembleState({ ...base, transport: 'waiting', transportReason: 'Connection closed', nextRetryAt: 5000 });
    expect(state).toMatchObject({ status: 'disconnected', statusDetail: 'Connection closed. Retrying automatically', nextRetryAt: 5000 });
  });
});
