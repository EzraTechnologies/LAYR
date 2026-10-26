import type { RawStatus } from '../moonraker/types';
import type { AssembleInputs } from '../printer/assemble';

/**
 * Deterministic sample data for demo mode, screenshots and CI. Scenarios are expressed as raw Moonraker
 * object status so they run through the same mapping code as a real printer. None of this is real data.
 */
export const DEMO_SCENARIOS = [
  'printing',
  'paused',
  'heating',
  'ready',
  'complete',
  'error',
  'disconnected',
  'connecting',
] as const;

export type DemoScenarioId = (typeof DEMO_SCENARIOS)[number];

export const DEMO_SCENARIO_LABELS: Record<DemoScenarioId, string> = {
  printing: 'Printing',
  paused: 'Paused',
  heating: 'Heating',
  ready: 'Idle',
  complete: 'Complete',
  error: 'Error',
  disconnected: 'Offline',
  connecting: 'Connecting',
};

/** Fixed clock for demo mode: 2026-01-15 14:32:00 UTC. */
export const DEMO_NOW = Date.UTC(2026, 0, 15, 14, 32, 0);

const DEMO_FILE = 'demo/cable_clip_set_PETG_0.2mm.gcode';

function heaters(nozzle: [number, number, number], bed: [number, number, number], chamber: number): RawStatus {
  return {
    extruder: { temperature: nozzle[0], target: nozzle[1], power: nozzle[2] },
    heater_bed: { temperature: bed[0], target: bed[1], power: bed[2] },
    'temperature_sensor chamber': { temperature: chamber },
    'temperature_sensor raspberry_pi': { temperature: 47.2 },
  };
}

function base(overrides: Partial<AssembleInputs>): AssembleInputs {
  return {
    printerId: 'demo',
    configuredName: 'Demo Printer',
    hostname: 'layr-demo',
    transport: 'connected',
    klippy: 'ready',
    klippyMessage: null,
    reconnectAttempt: 0,
    nextRetryAt: null,
    transportReason: null,
    raw: {},
    slicerEstimate: null,
    missingObjects: [],
    now: DEMO_NOW,
    ...overrides,
  };
}

function job(state: string, progress: number, printDuration: number, totalDuration: number, layer: number | null) {
  return {
    webhooks: { state: 'ready', state_message: 'Printer is ready' },
    print_stats: {
      filename: DEMO_FILE,
      state,
      message: '',
      print_duration: printDuration,
      total_duration: totalDuration,
      filament_used: Math.round(printDuration * 1.9),
      info: { current_layer: layer, total_layer: layer === null ? null : 160 },
    },
    display_status: { progress, message: null },
    virtual_sdcard: { progress, is_active: state === 'printing', file_path: `/gcodes/${DEMO_FILE}` },
  } satisfies RawStatus;
}

export function demoScenario(id: DemoScenarioId): AssembleInputs {
  switch (id) {
    case 'printing':
      return base({
        raw: { ...job('printing', 0.62, 5_814, 6_022, 99), ...heaters([239.6, 240, 0.48], [80.1, 80, 0.31], 37.8) },
        slicerEstimate: 9_600,
      });
    case 'paused':
      return base({
        raw: { ...job('paused', 0.41, 3_840, 4_410, 66), ...heaters([239.8, 240, 0.44], [80, 80, 0.3], 36.9) },
        slicerEstimate: 9_600,
      });
    case 'heating':
      return base({
        raw: { ...job('printing', 0, 0, 96, 0), ...heaters([168.4, 245, 1], [78.6, 85, 0.92], 29.5) },
        slicerEstimate: 9_600,
      });
    case 'ready':
      return base({
        raw: {
          webhooks: { state: 'ready', state_message: 'Printer is ready' },
          print_stats: { filename: '', state: 'standby', message: '', print_duration: 0, total_duration: 0, info: {} },
          display_status: { progress: 0, message: null },
          ...heaters([24.6, 0, 0], [23.9, 0, 0], 23.1),
        },
      });
    case 'complete':
      return base({
        raw: { ...job('complete', 1, 9_412, 9_655, 160), ...heaters([61.2, 0, 0], [55.4, 0, 0], 33.2) },
      });
    case 'error':
      return base({
        klippy: 'shutdown',
        klippyMessage: 'Demo: MCU shutdown reported by Klipper. Check wiring, then run FIRMWARE_RESTART from a trusted console.',
      });
    case 'disconnected':
      return base({
        transport: 'waiting',
        klippy: 'unknown',
        reconnectAttempt: 3,
        nextRetryAt: DEMO_NOW + 8_000,
        transportReason: 'Connection closed',
        hostname: null,
      });
    case 'connecting':
      return base({ transport: 'connecting', klippy: 'unknown', hostname: null });
  }
}
