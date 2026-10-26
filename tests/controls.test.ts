import { describe, expect, it } from 'vitest';
import { classifyResponse } from '../src/lib/console/console.svelte';
import { mapFans, mapLights, mapLimits, mapMacros, mapToolhead, scanMacroParams } from '../src/lib/moonraker/controls';
import { planSubscription } from '../src/lib/moonraker/objects';
import { assembleState, type AssembleInputs } from '../src/lib/printer/assemble';
import { FALLBACK_LIMITS } from '../src/lib/printer/model';
import { findMacro, LOAD_MACROS, UNLOAD_MACROS } from '../src/lib/filament';

describe('subscription plan for controls', () => {
  it('subscribes to fans, light-like pins, LEDs and filament sensors only', () => {
    const plan = planSubscription([
      'toolhead',
      'gcode_move',
      'fan',
      'fan_generic nevermore',
      'heater_fan hotend_fan',
      'controller_fan mcu',
      'output_pin caselight',
      'output_pin beeper',
      'neopixel sb_leds',
      'filament_switch_sensor runout',
      'gcode_macro PRINT_START',
      'configfile',
    ]);
    expect(Object.keys(plan.objects)).toEqual(
      expect.arrayContaining(['toolhead', 'gcode_move', 'fan', 'fan_generic nevermore', 'heater_fan hotend_fan', 'output_pin caselight', 'neopixel sb_leds', 'filament_switch_sensor runout']),
    );
    expect(plan.objects).not.toHaveProperty('output_pin beeper');
    expect(plan.objects).not.toHaveProperty('gcode_macro PRINT_START');
    expect(plan.objects).not.toHaveProperty('configfile');
    expect(plan.objects.toolhead).toContain('homed_axes');
  });
});

describe('toolhead, fans and lights', () => {
  it('maps toolhead state and Z offset', () => {
    expect(
      mapToolhead({
        toolhead: { homed_axes: 'XY', position: [1, 2, 3, 4], axis_minimum: [0, 0, -5, 0], axis_maximum: [250, 250, 230, 0], max_velocity: 300 },
        gcode_move: { homing_origin: [0, 0, -0.0251, 0], speed_factor: 1.1 },
      }),
    ).toEqual({
      homedAxes: 'xy',
      position: [1, 2, 3, 4],
      axisMin: [0, 0, -5],
      axisMax: [250, 250, 230],
      maxVelocity: 300,
      zOffset: -0.025,
      speedFactor: 1.1,
      extrudeFactor: null,
    });
    expect(mapToolhead({})).toBeNull();
    expect(mapToolhead({ toolhead: { position: [1, 'x'] } })?.position).toBeNull();
  });

  it('orders fans and marks which ones LAYR may control', () => {
    const fans = mapFans({
      'heater_fan hotend_fan': { speed: 1, rpm: 8000 },
      'fan_generic nevermore': { speed: 0.5 },
      fan: { speed: 1.2 },
    });
    expect(fans.map((f) => [f.label, f.controllable, f.speed])).toEqual([
      ['Part cooling', true, 1],
      ['Nevermore', true, 0.5],
      ['Hotend fan', false, 1],
    ]);
  });

  it('reads pin scale/pwm from the config and LED brightness from color_data', () => {
    const lights = mapLights(
      { 'output_pin caselight': { value: 0.4 }, 'neopixel sb': { color_data: [[0.1, 0.2, 0.3, 0.9]] } },
      { 'output_pin caselight': { pwm: true, scale: 10 } },
    );
    expect(lights).toEqual([
      { object: 'neopixel sb', label: 'Sb', kind: 'led', value: 0.9, dimmable: true, scale: 1 },
      { object: 'output_pin caselight', label: 'Caselight', kind: 'pin', value: 0.4, dimmable: true, scale: 10 },
    ]);
  });
});

describe('macros', () => {
  it('detects required and optional parameters', () => {
    expect(scanMacroParams('M190 S{params.BED|default(60)|int}\nM109 S{params.EXTRUDER|int}')).toEqual({
      params: ['BED', 'EXTRUDER'],
      required: ['EXTRUDER'],
    });
    expect(scanMacroParams("{% if 'TEMP' in params %}M104 S{params.TEMP}{% endif %}")).toEqual({ params: ['TEMP'], required: [] });
    expect(scanMacroParams('{% if params.SPEED is defined %}{params.SPEED}{% endif %}').required).toEqual([]);
    expect(scanMacroParams("{params['MODE']}").required).toEqual(['MODE']);
    expect(scanMacroParams(undefined)).toEqual({ params: [], required: [] });
  });

  it('maps macros from the object list with descriptions and hides "_" macros', () => {
    const macros = mapMacros(['gcode_macro print_start', 'gcode_macro _helper', 'extruder', 'gcode_macro LOAD_FILAMENT'], {
      'gcode_macro print_start': { gcode: 'G28', description: 'Start' },
      'gcode_macro load_filament': { gcode: 'G1 E{params.LENGTH|default(50)}', description: 'G-Code macro' },
    });
    expect(macros).toEqual([
      { name: '_HELPER', description: null, params: [], requiredParams: [], hidden: true },
      { name: 'LOAD_FILAMENT', description: null, params: ['LENGTH'], requiredParams: [], hidden: false },
      { name: 'PRINT_START', description: 'Start', params: [], requiredParams: [], hidden: false },
    ]);
  });

  it('finds load/unload macros only when they exist', () => {
    const macros = mapMacros(['gcode_macro M702', 'gcode_macro FILAMENT_LOAD'], {});
    expect(findMacro(macros, LOAD_MACROS)?.name).toBe('FILAMENT_LOAD');
    expect(findMacro(macros, UNLOAD_MACROS)?.name).toBe('M702');
    expect(findMacro([], LOAD_MACROS)).toBeNull();
  });
});

describe('limits', () => {
  it('reads heater and motion limits from configfile.settings', () => {
    expect(
      mapLimits({
        extruder: { min_temp: 10, max_temp: 300, min_extrude_temp: 180, max_extrude_only_distance: 150 },
        heater_bed: { min_temp: 0, max_temp: 120 },
        'heater_generic chamber': { min_temp: 0, max_temp: 70 },
        printer: { max_velocity: 300, max_z_velocity: 15 },
      }),
    ).toEqual({
      fromConfig: true,
      extruder: { minTemp: 10, maxTemp: 300, minExtrudeTemp: 180, maxExtrudeOnlyDistance: 150, maxExtrudeOnlyVelocity: null },
      bed: { minTemp: 0, maxTemp: 120 },
      heaters: { 'heater_generic chamber': { minTemp: 0, maxTemp: 70 } },
      maxVelocity: 300,
      maxZVelocity: 15,
    });
  });

  it('falls back to conservative limits when the config is unavailable', () => {
    expect(mapLimits({})).toEqual(FALLBACK_LIMITS);
  });
});

describe('assembleState with controls', () => {
  const inputs = (over: Partial<AssembleInputs> = {}): AssembleInputs => ({
    printerId: 'p',
    configuredName: '',
    hostname: 'trident',
    transport: 'connected',
    klippy: 'ready',
    klippyMessage: null,
    reconnectAttempt: 0,
    nextRetryAt: null,
    transportReason: null,
    raw: { extruder: { temperature: 200, target: 200, can_extrude: true }, fan: { speed: 0.5 }, idle_timeout: { state: 'Idle' } },
    slicerEstimate: null,
    missingObjects: [],
    objects: ['gcode_macro PARK'],
    settings: { extruder: { max_temp: 290 } },
    now: 0,
    ...over,
  });

  it('includes macros, limits and control state while ready', () => {
    const state = assembleState(inputs());
    expect(state).toMatchObject({ canExtrude: true, idleState: 'Idle', macros: [{ name: 'PARK' }], limits: { fromConfig: true } });
    expect(state.fans).toHaveLength(1);
  });

  it('drops all control data when not ready, so nothing stale can be acted on', () => {
    const state = assembleState(inputs({ transport: 'waiting' }));
    expect(state).toMatchObject({ canExtrude: null, toolhead: null, fans: [], lights: [], macros: [], limits: { fromConfig: false } });
  });
});

describe('console classification', () => {
  it('classifies Klipper responses', () => {
    expect(classifyResponse('!! Must home axis first')).toBe('error');
    expect(classifyResponse('// Klipper state: Ready')).toBe('response');
    expect(classifyResponse('// Warning: something')).toBe('warning');
  });
});
