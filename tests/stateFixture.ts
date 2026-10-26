import { createInitialState, type JobInfo, type PrinterState } from '../src/lib/printer/model';

type Overrides = Partial<Omit<PrinterState, 'toolhead'>> & { toolhead?: Partial<NonNullable<PrinterState['toolhead']>> | null };

/** A connected, ready, homed printer with a 250×250×230 build volume. Override anything per test. */
export function readyState(overrides: Overrides = {}): PrinterState {
  const base = createInitialState('p1', 'Trident', 0);
  const { toolhead, ...rest } = overrides;
  const state: PrinterState = {
    ...base,
    status: 'ready',
    transport: 'connected',
    klippy: 'ready',
    extruder: { object: 'extruder', label: 'Nozzle', temperature: 25, target: 0, power: 0 },
    bed: { object: 'heater_bed', label: 'Bed', temperature: 24, target: 0, power: 0 },
    canExtrude: false,
    toolhead: {
      homedAxes: 'xyz',
      position: [125, 125, 10, 0],
      axisMin: [0, 0, -5],
      axisMax: [250, 250, 230],
      maxVelocity: 300,
      zOffset: 0,
      speedFactor: 1,
      extrudeFactor: 1,
    },
    limits: {
      fromConfig: true,
      extruder: { minTemp: 10, maxTemp: 300, minExtrudeTemp: 170, maxExtrudeOnlyDistance: 150, maxExtrudeOnlyVelocity: 50 },
      bed: { minTemp: 0, maxTemp: 120 },
      heaters: {},
      maxVelocity: 300,
      maxZVelocity: 15,
    },
    fans: [
      { object: 'fan', label: 'Part cooling', speed: 0, rpm: null, controllable: true },
      { object: 'fan_generic nevermore', label: 'Nevermore', speed: 0, rpm: null, controllable: true },
      { object: 'heater_fan hotend_fan', label: 'Hotend fan', speed: 1, rpm: null, controllable: false },
    ],
    lights: [
      { object: 'output_pin caselight', label: 'Caselight', kind: 'pin', value: 0, dimmable: true, scale: 1 },
      { object: 'output_pin relay_light', label: 'Relay light', kind: 'pin', value: 0, dimmable: false, scale: 1 },
      { object: 'neopixel sb_leds', label: 'Sb leds', kind: 'led', value: 0, dimmable: true, scale: 1 },
    ],
    macros: [
      { name: 'LOAD_FILAMENT', description: 'Load', params: [], requiredParams: [], hidden: false },
      { name: 'HEATSOAK', description: null, params: ['TEMP'], requiredParams: ['TEMP'], hidden: false },
      { name: '_INTERNAL', description: null, params: [], requiredParams: [], hidden: true },
    ],
    ...rest,
  };
  if (toolhead === null) state.toolhead = null;
  else if (toolhead) state.toolhead = { ...state.toolhead!, ...toolhead };
  return state;
}

export function withJob(state: PrinterState, jobState: JobInfo['state'], filename = 'part.gcode'): PrinterState {
  return {
    ...state,
    status: jobState === 'printing' ? 'printing' : jobState === 'paused' ? 'paused' : 'ready',
    job: {
      filename,
      state: jobState,
      progress: 0.5,
      printDuration: 100,
      totalDuration: 110,
      remaining: 100,
      remainingSource: 'progress',
      currentLayer: 3,
      totalLayers: 10,
      filamentUsed: 100,
      message: null,
    },
  };
}
