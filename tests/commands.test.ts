import { describe, expect, it } from 'vitest';
import { normaliseConsoleInput, prepareCommand, type PrinterCommand, type Prepared } from '../src/lib/actions/commands';
import { readyState, withJob } from './stateFixture';

function plan(result: Prepared) {
  if (!result.ok) throw new Error(`Expected ok, got: ${result.message}`);
  return result.plan;
}

function blocked(result: Prepared): string {
  if (result.ok) throw new Error(`Expected blocked, got ${result.plan.summary}`);
  return result.message;
}

const script = (result: Prepared) => plan(result).params?.script;

describe('connection gates', () => {
  const commands: PrinterCommand[] = [
    { kind: 'home', axes: [] },
    { kind: 'jog', axis: 'x', distance: 1, speed: 50 },
    { kind: 'extrude', length: 5, speed: 5 },
    { kind: 'set_temperature', heater: 'extruder', target: 200 },
    { kind: 'set_fan', fan: 'fan', speed: 1 },
    { kind: 'macro', name: 'LOAD_FILAMENT' },
    { kind: 'mmu', action: 'load' },
    { kind: 'start_print', filename: 'a.gcode' },
    { kind: 'pause' },
    { kind: 'emergency_stop' },
    { kind: 'gcode', script: 'STATUS' },
    { kind: 'delete_file', path: 'a.gcode' },
  ];

  it.each(commands)('blocks $kind while offline', (command) => {
    expect(blocked(prepareCommand(command, readyState({ transport: 'waiting', status: 'disconnected' })))).toBe('Printer is offline');
  });

  it.each(commands)('blocks $kind before an endpoint is configured', (command) => {
    const message = blocked(prepareCommand(command, readyState({ transport: 'idle', status: 'unconfigured' })));
    expect(message).toMatch(/Set up the printer connection|offline/);
  });

  it('blocks motion while Klipper is shut down but allows restarts and the emergency stop', () => {
    const state = readyState({ klippy: 'shutdown', status: 'error' });
    expect(blocked(prepareCommand({ kind: 'home', axes: [] }, state))).toMatch(/error state/);
    expect(plan(prepareCommand({ kind: 'firmware_restart' }, state)).method).toBe('printer.firmware_restart');
    expect(plan(prepareCommand({ kind: 'restart' }, state)).method).toBe('printer.restart');
    expect(plan(prepareCommand({ kind: 'emergency_stop' }, state)).method).toBe('printer.emergency_stop');
    // FIRMWARE_RESTART must be typeable in the console while shut down.
    expect(script(prepareCommand({ kind: 'gcode', script: 'FIRMWARE_RESTART' }, state))).toBe('FIRMWARE_RESTART');
  });
});

describe('homing', () => {
  it('homes all axes or the selected ones', () => {
    expect(script(prepareCommand({ kind: 'home', axes: [] }, readyState()))).toBe('G28');
    expect(script(prepareCommand({ kind: 'home', axes: ['x', 'y', 'z'] }, readyState()))).toBe('G28');
    expect(script(prepareCommand({ kind: 'home', axes: ['y', 'x'] }, readyState()))).toBe('G28 X Y');
  });

  it('requires X and Y to be homed before homing Z alone', () => {
    const state = readyState({ toolhead: { homedAxes: '' } });
    expect(blocked(prepareCommand({ kind: 'home', axes: ['z'] }, state))).toBe('Home X and Y first, or use Home all');
    expect(script(prepareCommand({ kind: 'home', axes: ['z'] }, readyState({ toolhead: { homedAxes: 'xy' } })))).toBe('G28 Z');
  });

  it('is not available during a print', () => {
    expect(blocked(prepareCommand({ kind: 'home', axes: [] }, withJob(readyState(), 'printing')))).toMatch(/during a print/);
    expect(blocked(prepareCommand({ kind: 'home', axes: [] }, withJob(readyState(), 'paused')))).toMatch(/during a print/);
  });
});

describe('jogging', () => {
  const jog = (axis: 'x' | 'y' | 'z', distance: number, speed = 50) => ({ kind: 'jog', axis, distance, speed }) as const;

  it('wraps a relative move in SAVE/RESTORE_GCODE_STATE so the absolute/relative mode is preserved', () => {
    expect(script(prepareCommand(jog('x', 10), readyState()))).toBe(
      'SAVE_GCODE_STATE NAME=layr_jog\nG91\nG1 X10 F3000\nRESTORE_GCODE_STATE NAME=layr_jog',
    );
    expect(plan(prepareCommand(jog('x', 10), readyState())).group).toBe('motion');
  });

  it('refuses to move an axis that is not homed', () => {
    const state = readyState({ toolhead: { homedAxes: 'z' } });
    expect(blocked(prepareCommand(jog('x', 1), state))).toBe('Home X first');
    expect(blocked(prepareCommand(jog('y', -1), state))).toBe('Home Y first');
    expect(plan(prepareCommand(jog('z', 1), state)).summary).toBe('Move Z +1 mm');
  });

  it('clamps moves to the axis limits and explains the adjustment', () => {
    const state = readyState({ toolhead: { position: [245, 3, 10, 0] } });
    const p = plan(prepareCommand(jog('x', 10), state));
    expect(p.params?.script).toContain('G1 X5 F3000');
    expect(p.note).toBe('Limited to 5 mm by the X travel limit');
    expect(script(prepareCommand(jog('y', -10), state))).toContain('G1 Y-3 F3000');
  });

  it('never jogs Z below 0 even when position_min is negative', () => {
    const state = readyState({ toolhead: { position: [125, 125, 0.4, 0] } });
    expect(script(prepareCommand(jog('z', -10, 10), state))).toContain('G1 Z-0.4 F600');
    expect(blocked(prepareCommand(jog('z', -1), readyState({ toolhead: { position: [125, 125, 0, 0] } })))).toBe(
      'Z is at its safe minimum (0 mm)',
    );
  });

  it('blocks moves at the limit, oversized steps and invalid values', () => {
    expect(blocked(prepareCommand(jog('x', 1), readyState({ toolhead: { position: [250, 0, 10, 0] } })))).toBe(
      'X is at its maximum (250 mm)',
    );
    expect(blocked(prepareCommand(jog('x', 150), readyState()))).toMatch(/limited to 100 mm/);
    expect(blocked(prepareCommand(jog('x', Number.NaN), readyState()))).toBe('Choose a distance');
    expect(blocked(prepareCommand(jog('x', 1, 0), readyState()))).toBe('Choose a speed');
    expect(blocked(prepareCommand(jog('x', 1), readyState({ toolhead: { position: null } })))).toMatch(/position/);
  });

  it('limits speed to the printer maximum and to a safe Z speed', () => {
    const fast = plan(prepareCommand(jog('x', 1, 500), readyState({ toolhead: { maxVelocity: 200 } })));
    expect(fast.params?.script).toContain('F12000');
    expect(fast.note).toBe('Speed limited to 200 mm/s');
    expect(script(prepareCommand(jog('z', 1, 100), readyState()))).toContain('F900');
  });

  it('waits for the reported position before releasing the motion group', () => {
    const p = plan(prepareCommand(jog('x', 10), readyState()));
    expect(p.settled?.(readyState())).toBe(false);
    expect(p.settled?.(readyState({ toolhead: { position: [135, 125, 10, 0] } }))).toBe(true);
  });

  it('is locked during prints', () => {
    expect(blocked(prepareCommand(jog('z', 1), withJob(readyState(), 'paused')))).toMatch(/during a print/);
  });
});

describe('temperatures', () => {
  const setTemp = (heater: string, target: number) => ({ kind: 'set_temperature', heater, target }) as const;

  it('uses SET_HEATER_TEMPERATURE with whole degrees', () => {
    expect(script(prepareCommand(setTemp('extruder', 214.6), readyState()))).toBe('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=215');
    expect(script(prepareCommand(setTemp('heater_bed', 0), readyState()))).toBe('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=0');
  });

  it('enforces min/max from the printer config', () => {
    expect(blocked(prepareCommand(setTemp('extruder', 301), readyState()))).toBe('Nozzle accepts 0 or 10–300 °C');
    expect(blocked(prepareCommand(setTemp('extruder', 5), readyState()))).toBe('Nozzle accepts 0 or 10–300 °C');
    expect(blocked(prepareCommand(setTemp('heater_bed', 121), readyState()))).toBe('Bed accepts 0 or 0–120 °C');
    expect(blocked(prepareCommand(setTemp('extruder', -1), readyState()))).toMatch(/negative/);
    expect(blocked(prepareCommand(setTemp('extruder', Number.POSITIVE_INFINITY), readyState()))).toBe('Enter a temperature');
  });

  it('falls back to conservative limits without config', () => {
    const state = readyState();
    state.limits = { ...state.limits, fromConfig: false, extruder: { ...state.limits.extruder, minTemp: 0, maxTemp: 280 }, bed: { minTemp: 0, maxTemp: 110 } };
    expect(blocked(prepareCommand(setTemp('extruder', 290), state))).toBe('Nozzle accepts 0 or 0–280 °C');
  });

  it('rejects unknown heaters and plain sensors', () => {
    const state = readyState({ chamber: { object: 'temperature_sensor chamber', label: 'Chamber', temperature: 30, target: null, power: null } });
    expect(blocked(prepareCommand(setTemp('temperature_sensor chamber', 50), state))).toBe('This heater is not available');
    expect(blocked(prepareCommand(setTemp('heater_generic nope', 50), state))).toBe('This heater is not available');
  });

  it('confirms high targets and changes during a print', () => {
    expect(plan(prepareCommand(setTemp('extruder', 260), readyState())).confirm).toBeNull();
    expect(plan(prepareCommand(setTemp('extruder', 270), readyState())).confirm).toMatchObject({ tone: 'warn', title: 'Heat Nozzle to 270 °C?' });
    expect(plan(prepareCommand(setTemp('heater_bed', 110), readyState())).confirm).not.toBeNull();
    const printing = withJob(readyState({ extruder: { object: 'extruder', label: 'Nozzle', temperature: 240, target: 240, power: 0.4 } }), 'printing');
    expect(plan(prepareCommand(setTemp('extruder', 245), printing)).confirm?.title).toBe('Change Nozzle during the print?');
    expect(plan(prepareCommand(setTemp('extruder', 240), printing)).confirm).toBeNull();
  });
});

describe('extrusion', () => {
  const hot = () => readyState({ extruder: { object: 'extruder', label: 'Nozzle', temperature: 230, target: 230, power: 0.3 }, canExtrude: true });

  it('prevents cold extrusion using temperature and can_extrude', () => {
    expect(blocked(prepareCommand({ kind: 'extrude', length: 5, speed: 5 }, readyState()))).toBe(
      'Nozzle is below 170 °C. Heat it before extruding',
    );
    expect(blocked(prepareCommand({ kind: 'extrude', length: 5, speed: 5 }, { ...hot(), canExtrude: false }))).toMatch(/below 170/);
  });

  it('extrudes and retracts relative to the current state', () => {
    expect(script(prepareCommand({ kind: 'extrude', length: 10, speed: 5 }, hot()))).toBe(
      'SAVE_GCODE_STATE NAME=layr_extrude\nM83\nG1 E10 F300\nRESTORE_GCODE_STATE NAME=layr_extrude',
    );
    expect(script(prepareCommand({ kind: 'extrude', length: -5, speed: 2 }, hot()))).toContain('G1 E-5 F120');
  });

  it('bounds length and speed', () => {
    const state = hot();
    state.limits.extruder.maxExtrudeOnlyDistance = 50;
    expect(blocked(prepareCommand({ kind: 'extrude', length: 60, speed: 5 }, state))).toBe('Limited to 50 mm per move');
    expect(blocked(prepareCommand({ kind: 'extrude', length: 120, speed: 5 }, hot()))).toBe('Limited to 100 mm per move');
    expect(plan(prepareCommand({ kind: 'extrude', length: 5, speed: 40 }, hot())).note).toBe('Speed limited to 15 mm/s');
  });

  it('is blocked while printing but allowed while paused', () => {
    expect(blocked(prepareCommand({ kind: 'extrude', length: 5, speed: 5 }, withJob(hot(), 'printing')))).toMatch(/Pause first/);
    expect(plan(prepareCommand({ kind: 'extrude', length: 5, speed: 5 }, withJob(hot(), 'paused'))).method).toBe('printer.gcode.script');
  });
});

describe('fans and lights', () => {
  it('drives the part fan with M106/M107 and generic fans with SET_FAN_SPEED', () => {
    expect(script(prepareCommand({ kind: 'set_fan', fan: 'fan', speed: 0.5 }, readyState()))).toBe('M106 S128');
    expect(script(prepareCommand({ kind: 'set_fan', fan: 'fan', speed: 0 }, readyState()))).toBe('M107');
    expect(script(prepareCommand({ kind: 'set_fan', fan: 'fan', speed: 7 }, readyState()))).toBe('M106 S255');
    expect(script(prepareCommand({ kind: 'set_fan', fan: 'fan_generic nevermore', speed: 0.75 }, readyState()))).toBe(
      'SET_FAN_SPEED FAN=nevermore SPEED=0.75',
    );
  });

  it('does not control automatic fans', () => {
    expect(blocked(prepareCommand({ kind: 'set_fan', fan: 'heater_fan hotend_fan', speed: 0 }, readyState()))).toMatch(/automatically/);
  });

  it('scales output pins, snaps on/off pins and sets all LED channels', () => {
    const state = readyState();
    state.lights[0]!.scale = 10;
    expect(script(prepareCommand({ kind: 'set_light', light: 'output_pin caselight', value: 0.5 }, state))).toBe('SET_PIN PIN=caselight VALUE=5');
    expect(script(prepareCommand({ kind: 'set_light', light: 'output_pin relay_light', value: 0.6 }, state))).toBe('SET_PIN PIN=relay_light VALUE=1');
    expect(script(prepareCommand({ kind: 'set_light', light: 'neopixel sb_leds', value: 0.25 }, state))).toBe(
      'SET_LED LED=sb_leds RED=0.25 GREEN=0.25 BLUE=0.25 WHITE=0.25',
    );
  });
});

describe('print, files and macros', () => {
  it('confirms print start, cancel and file deletion', () => {
    expect(plan(prepareCommand({ kind: 'start_print', filename: 'dir/a.gcode' }, readyState()))).toMatchObject({
      method: 'printer.print.start',
      params: { filename: 'dir/a.gcode' },
      confirm: { confirmLabel: 'Start print' },
    });
    expect(plan(prepareCommand({ kind: 'cancel' }, withJob(readyState(), 'paused'))).confirm?.tone).toBe('danger');
    expect(plan(prepareCommand({ kind: 'delete_file', path: 'dir/a.gcode' }, readyState()))).toMatchObject({
      method: 'server.files.delete_file',
      params: { path: 'gcodes/dir/a.gcode' },
      confirm: { tone: 'danger' },
    });
  });

  it('adjusts M220 and M221 percentages without treating them as live speed or flow', () => {
    const printing = withJob(readyState(), 'printing');
    expect(script(prepareCommand({ kind: 'set_speed_factor', percent: 160 }, printing))).toBe('M220 S160');
    expect(script(prepareCommand({ kind: 'set_extrude_factor', percent: 90 }, printing))).toBe('M221 S90');
    expect(script(prepareCommand({ kind: 'set_speed_factor', percent: 5 }, printing))).toBe('M220 S10');
    expect(plan(prepareCommand({ kind: 'set_speed_factor', percent: 5 }, printing)).note).toMatch(/10%/);
    expect(script(prepareCommand({ kind: 'set_extrude_factor', percent: 900 }, printing))).toBe('M221 S200');
    expect(blocked(prepareCommand({ kind: 'set_speed_factor', percent: Number.NaN }, printing))).toBe('Enter a percentage');
  });

  it('keeps pause/resume state consistent', () => {
    expect(blocked(prepareCommand({ kind: 'pause' }, readyState()))).toBe('No print is running');
    expect(blocked(prepareCommand({ kind: 'resume' }, withJob(readyState(), 'printing')))).toBe('The print is not paused');
    expect(plan(prepareCommand({ kind: 'pause' }, withJob(readyState(), 'printing'))).confirm).toBeNull();
  });

  it('rejects path traversal and protects the active file', () => {
    for (const path of ['../printer.cfg', '/etc/passwd', 'a/../../b.gcode', '', 'a\\b.gcode']) {
      expect(prepareCommand({ kind: 'delete_file', path }, readyState()).ok).toBe(false);
      expect(prepareCommand({ kind: 'start_print', filename: path }, readyState()).ok).toBe(false);
    }
    expect(blocked(prepareCommand({ kind: 'delete_file', path: 'part.gcode' }, withJob(readyState(), 'printing')))).toBe('This file is being printed');
    expect(blocked(prepareCommand({ kind: 'start_print', filename: 'x.gcode' }, withJob(readyState(), 'paused')))).toMatch(/already in progress/);
  });

  it('runs only known macros, always with confirmation, and never without required parameters', () => {
    expect(plan(prepareCommand({ kind: 'macro', name: 'LOAD_FILAMENT' }, readyState()))).toMatchObject({
      params: { script: 'LOAD_FILAMENT' },
      confirm: { confirmLabel: 'Run macro' },
    });
    expect(blocked(prepareCommand({ kind: 'macro', name: 'HEATSOAK' }, readyState()))).toMatch(/needs TEMP/);
    expect(blocked(prepareCommand({ kind: 'macro', name: 'NOT_A_MACRO' }, readyState()))).toBe('This macro is not available');
    expect(blocked(prepareCommand({ kind: 'macro', name: 'LOAD_FILAMENT\nM112' }, readyState()))).toBe('This macro is not available');
  });
});

describe('console', () => {
  it('sends exactly one confirmed line', () => {
    const p = plan(prepareCommand({ kind: 'gcode', script: '  QUERY_ENDSTOPS  ' }, readyState()));
    expect(p.params?.script).toBe('QUERY_ENDSTOPS');
    expect(p.confirm).toMatchObject({ title: 'Send this command?', tone: 'primary' });
    expect(plan(prepareCommand({ kind: 'gcode', script: 'SAVE_CONFIG' }, readyState())).confirm?.tone).toBe('warn');
  });

  it('rejects multi-line, empty, oversized or control-character input', () => {
    expect(normaliseConsoleInput('G28\nG1 X10')).toEqual({ ok: false, message: 'Send one command at a time' });
    expect(normaliseConsoleInput('   ')).toEqual({ ok: false, message: 'Type a command' });
    expect(normaliseConsoleInput('M117 ' + 'x'.repeat(300)).ok).toBe(false);
    expect(normaliseConsoleInput('G28\u0007').ok).toBe(false);
  });

  it('routes M112 to the emergency stop endpoint, as the Moonraker docs require', () => {
    expect(plan(prepareCommand({ kind: 'gcode', script: 'm112' }, readyState()))).toMatchObject({ method: 'printer.emergency_stop', confirm: null });
  });
});

describe('Z offset', () => {
  it('babysteps with SET_GCODE_OFFSET and bounds the step and total', () => {
    const printing = withJob(readyState({ toolhead: { zOffset: -0.05 } }), 'printing');
    expect(script(prepareCommand({ kind: 'z_offset', delta: -0.01 }, printing))).toBe('SET_GCODE_OFFSET Z_ADJUST=-0.01 MOVE=1');
    expect(blocked(prepareCommand({ kind: 'z_offset', delta: 0.5 }, printing))).toMatch(/Steps are limited/);
    expect(blocked(prepareCommand({ kind: 'z_offset', delta: -0.1 }, readyState({ toolhead: { zOffset: -1.95 } })))).toMatch(/limited to ±2/);
    expect(blocked(prepareCommand({ kind: 'z_offset', delta: 0.01 }, readyState({ toolhead: { homedAxes: 'xy' } })))).toBe('Home Z first');
  });
});
