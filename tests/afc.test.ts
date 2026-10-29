import { describe, expect, it } from 'vitest';
import {
  afcLaneButtons,
  afcMotionBlock,
  afcScript,
  afcUnloadButton,
  prepareCommand,
  type Prepared,
} from '../src/lib/actions/commands';
import { groupAfcLanes, mapAfc } from '../src/lib/afc/map';
import { AFC_LANE_FIELDS, AFC_STATUS_FIELDS, MAX_AFC_LANES, afcCommandsFromHelp, afcSubscription } from '../src/lib/afc/objects';
import { planSubscription } from '../src/lib/moonraker/objects';
import { assembleState, type AssembleInputs } from '../src/lib/printer/assemble';
import type { AfcLane, AfcStatus } from '../src/lib/afc/types';
import { navItems, parseRoute, ROUTES } from '../src/lib/routes';
import { readyState, withJob } from './stateFixture';

function plan(result: Prepared) {
  if (!result.ok) throw new Error(`Expected ok, got: ${result.message}`);
  return result.plan;
}

function blocked(result: Prepared): string {
  if (result.ok) throw new Error(`Expected blocked, got ${result.plan.summary}`);
  return result.message;
}

function lane(name: string, fields: Partial<AfcLane> = {}): AfcLane {
  return {
    name,
    object: `AFC_lane ${name}`,
    detailReported: true,
    unit: 'Turtle_1',
    hub: 'Turtle_1',
    extruder: 'extruder',
    buffer: 'Turtle_1',
    bufferStatus: 'Advancing',
    index: 1,
    map: 'T0',
    load: true,
    prep: true,
    toolLoaded: false,
    loadedToHub: false,
    material: 'PETG',
    filamentName: 'Polymaker PETG',
    color: '#3ee0f0',
    weight: 800,
    spoolId: 4,
    filamentStatus: 'Ready',
    status: 'None',
    runoutLane: null,
    ...fields,
  };
}

function afc(overrides: Partial<AfcStatus> = {}): AfcStatus {
  return {
    reported: true,
    state: 'Idle',
    error: false,
    currentLoad: 'lane2',
    currentLoadKnown: true,
    currentLane: null,
    nextLane: null,
    bypass: false,
    positionSaved: false,
    toolchange: null,
    message: null,
    units: [{ name: 'Turtle_1', typeLabel: 'Box turtle', object: 'AFC_BoxTurtle Turtle_1', laneNames: ['lane2', 'lane4'] }],
    lanes: [
      lane('lane2', { toolLoaded: true, loadedToHub: true, material: 'ABS', filamentStatus: 'In Tool', status: 'Tooled', map: 'T0', index: 2 }),
      lane('lane3', { loadedToHub: true, material: 'PLA', map: 'T2', index: 3, filamentStatus: 'Ready', status: 'Loaded' }),
      lane('lane4', { map: 'T3', index: 4 }),
    ],
    commands: ['TOOL_LOAD', 'TOOL_UNLOAD', 'CHANGE_TOOL', 'HUB_LOAD', 'LANE_UNLOAD'],
    truncated: false,
    ...overrides,
  };
}

function stateWith(overrides: Partial<AfcStatus> = {}) {
  return readyState({ afc: afc(overrides), idleState: 'Idle' });
}

describe('AFC subscription', () => {
  it('leaves the plan unchanged when the printer has no AFC object', () => {
    const without = planSubscription(['extruder', 'AFC_lane lane1', 'AFC_BoxTurtle Turtle_1', 'mmu']);
    const plain = planSubscription(['extruder']);
    expect(without.objects).toEqual(plain.objects);
    expect(without.objects).not.toHaveProperty('AFC');
    expect(without.objects).not.toHaveProperty('AFC_lane lane1');
    expect(without.objects).not.toHaveProperty('mmu');
  });

  it('subscribes to documented AFC fields and ignores modules that are not units or lanes', () => {
    const plan = planSubscription([
      'extruder',
      'AFC',
      'AFC_lane lane1',
      'AFC_stepper legacy',
      'AFC_BoxTurtle Turtle_1',
      'AFC_logger',
      'AFC_error',
      'AFC_buffer buf',
      'mmu',
    ]);
    expect(plan.objects.AFC).toEqual([...AFC_STATUS_FIELDS]);
    expect(plan.objects['AFC_lane lane1']).toEqual([...AFC_LANE_FIELDS]);
    expect(plan.objects['AFC_stepper legacy']).toEqual([...AFC_LANE_FIELDS]);
    expect(plan.objects['AFC_BoxTurtle Turtle_1']).toEqual(['lanes', 'extruders', 'hubs', 'buffers']);
    expect(plan.objects).not.toHaveProperty('AFC_logger');
    expect(plan.objects).not.toHaveProperty('AFC_error');
    expect(plan.objects).not.toHaveProperty('AFC_buffer buf');
    expect(plan.objects).not.toHaveProperty('mmu');
  });

  it('caps lane objects and records that the list was cut', () => {
    const names = Array.from({ length: MAX_AFC_LANES + 4 }, (_, i) => `AFC_lane lane${i + 1}`);
    const selected = afcSubscription(['AFC', ...names]);
    expect(Object.keys(selected.objects).filter((name) => name.startsWith('AFC_lane '))).toHaveLength(MAX_AFC_LANES);
    expect(selected.truncated).toBe(true);
  });
});

describe('AFC help and status mapping', () => {
  it('keeps only documented commands that help actually lists', () => {
    expect(afcCommandsFromHelp({ TOOL_LOAD: 'Load lane into tool', G28: 'home', TOOL_UNLOAD: '' })).toEqual(['TOOL_LOAD', 'TOOL_UNLOAD']);
    expect(afcCommandsFromHelp(null)).toEqual([]);
    expect(afcCommandsFromHelp(['TOOL_LOAD'])).toEqual([]);
  });

  it('maps units, lanes, the loaded lane, and an error message without inventing missing fields', () => {
    const mapped = mapAfc(
      {
        AFC: {
          current_load: 'lane2',
          current_lane: null,
          next_lane: null,
          current_state: 'Idle',
          error_state: false,
          bypass_state: false,
          position_saved: false,
          current_toolchange: 2,
          number_of_toolchanges: 8,
          units: ['Box_Turtle Turtle_1'],
          lanes: ['lane1', 'lane2'],
          message: { message: '', type: '' },
        },
        'AFC_BoxTurtle Turtle_1': { lanes: ['lane1', 'lane2'], extruders: ['extruder'], hubs: ['Turtle_1'], buffers: [] },
        'AFC_lane lane1': {},
        'AFC_lane lane2': {
          name: 'lane2',
          unit: 'Turtle_1',
          map: 'T0',
          load: true,
          prep: true,
          tool_loaded: true,
          loaded_to_hub: true,
          material: 'ABS',
          filament_name: 'Polymaker ABS',
          color: '#3D441E',
          weight: 497.2,
          spool_id: 35,
          filament_status: 'In Tool',
          status: 'Tooled',
          lane: 2,
        },
        'AFC_stepper lane2': { material: 'should-not-win', color: 'red' },
      },
      ['AFC', 'AFC_BoxTurtle Turtle_1', 'AFC_lane lane1', 'AFC_lane lane2', 'AFC_stepper lane2'],
      ['TOOL_LOAD', 'NOT_A_COMMAND'],
    );
    expect(mapped).toMatchObject({
      reported: true,
      state: 'Idle',
      error: false,
      currentLoad: 'lane2',
      currentLoadKnown: true,
      commands: ['TOOL_LOAD'],
      toolchange: { current: 2, total: 8 },
      message: null,
    });
    expect(mapped?.units[0]).toMatchObject({ name: 'Turtle_1', typeLabel: 'Box Turtle', laneNames: ['lane1', 'lane2'] });
    const empty = mapped?.lanes.find((item) => item.name === 'lane1');
    expect(empty).toMatchObject({ detailReported: false, material: null, color: null, prep: null });
    const loaded = mapped?.lanes.find((item) => item.name === 'lane2');
    expect(loaded).toMatchObject({ detailReported: true, material: 'ABS', color: '#3D441E', filamentStatus: 'In Tool' });
    expect(groupAfcLanes(mapped!).map((group) => [group.title, group.lanes.map((item) => item.name)])).toEqual([
      ['Box Turtle · Turtle_1', ['lane1', 'lane2']],
    ]);
  });

  it('does not treat a missing current_load as an empty tool, and drops unsafe colors', () => {
    const missing = mapAfc({ AFC: { current_state: 'Idle', error_state: false, lanes: [] } }, ['AFC'], []);
    expect(missing).toMatchObject({ currentLoad: null, currentLoadKnown: false });
    const empty = mapAfc({ AFC: { current_load: null, current_state: 'Idle', lanes: [] } }, ['AFC'], []);
    expect(empty).toMatchObject({ currentLoad: null, currentLoadKnown: true });
    const bad = mapAfc(
      {
        AFC: { current_load: 'lane1', current_state: 'Error', error_state: true, lanes: ['lane1'], message: { message: 'Sensor fault', type: 'error' } },
        'AFC_lane lane1': { color: 'red', prep: false, load: false },
      },
      ['AFC', 'AFC_lane lane1'],
      [],
    );
    expect(bad?.lanes[0]?.color).toBeNull();
    expect(bad?.message).toEqual({ text: 'Sensor fault', type: 'error' });
    expect(bad?.error).toBe(true);
  });

  it('is absent from the view model when Klipper is not ready or the object is missing', () => {
    const input: AssembleInputs = {
      printerId: 'p',
      configuredName: 'Trident',
      hostname: 'trident',
      transport: 'connected',
      klippy: 'ready',
      klippyMessage: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
      transportReason: null,
      raw: { AFC: { current_state: 'Idle', current_load: null, error_state: false, lanes: [] } },
      slicerEstimate: null,
      missingObjects: [],
      objects: ['AFC'],
      afcCommands: [],
      settings: {},
      thumbnailPath: null,
      now: 0,
    };
    expect(assembleState(input).afc).toMatchObject({ reported: true, state: 'Idle' });
    expect(assembleState({ ...input, objects: ['extruder'] }).afc).toBeNull();
    expect(assembleState({ ...input, klippy: 'shutdown' }).afc).toBeNull();
  });
});

describe('AFC lane commands', () => {
  it('confirms a load and sends only the documented command', () => {
    const state = stateWith({ currentLoad: null, lanes: [lane('lane4')] });
    const prepared = prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, state);
    expect(plan(prepared).params?.script).toBe('TOOL_LOAD LANE=lane4');
    expect(plan(prepared).group).toBe('afc');
    expect(plan(prepared).confirm?.confirmLabel).toBe('Load lane');
    expect(afcScript('tool_load', 'lane4')).toBe('TOOL_LOAD LANE=lane4');
    expect(afcLaneButtons(state, 'lane4').map((button) => button.label)).toEqual(['Load', 'To hub']);
  });

  it('uses change-tool when another lane is loaded, and unload for the loaded lane', () => {
    const state = stateWith();
    expect(plan(prepareCommand({ kind: 'afc', action: 'change_tool', lane: 'lane4' }, state)).params?.script).toBe('CHANGE_TOOL LANE=lane4');
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, state))).toMatch(/already loaded/);
    expect(plan(prepareCommand({ kind: 'afc', action: 'tool_unload', lane: 'lane2' }, state)).confirm?.tone).toBe('danger');
    expect(afcUnloadButton(state)?.name).toBe('Unload lane2');
    expect(afcLaneButtons(state, 'lane3').map((button) => button.action)).toEqual(['change_tool', 'lane_unload']);
    expect(plan(prepareCommand({ kind: 'afc', action: 'lane_unload', lane: 'lane3' }, state)).params?.script).toBe('LANE_UNLOAD LANE=lane3');
  });

  it('refuses motions that are unsafe or not supported, and never interpolates the lane name', () => {
    const ready = stateWith({ currentLoad: null, lanes: [lane('lane4')] });
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4\nRESTART' }, ready))).toMatch(/cannot be sent/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane9' }, ready))).toMatch(/not reported/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, stateWith({ commands: [] })))).toMatch(/not available/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, readyState()))).toMatch(/not installed/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, stateWith({ error: true })))).toMatch(/error/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, stateWith({ bypass: true })))).toMatch(/Bypass/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, stateWith({ state: 'Loading', currentLane: 'lane4' })))).toBe(
      'AFC is Loading',
    );
    expect(afcMotionBlock(stateWith({ state: 'Loading' }))).toBe('AFC is Loading');
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, stateWith({ currentLoadKnown: false })))).toMatch(
      /which lane is loaded/,
    );
    expect(
      blocked(
        prepareCommand(
          { kind: 'afc', action: 'tool_load', lane: 'lane1' },
          stateWith({ currentLoad: null, lanes: [lane('lane1', { prep: false, load: false })] }),
        ),
      ),
    ).toMatch(/not ready/);
    expect(
      blocked(
        prepareCommand(
          { kind: 'afc', action: 'tool_load', lane: 'lane4' },
          readyState({ afc: afc({ currentLoad: null, lanes: [lane('lane4')] }), idleState: 'Printing' }),
        ),
      ),
    ).toMatch(/busy/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'hub_load', lane: 'lane4' }, withJob(ready, 'printing')))).toMatch(/during a print/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_unload', lane: 'lane2' }, withJob(stateWith(), 'paused')))).toMatch(/during a print/);
    expect(blocked(prepareCommand({ kind: 'afc', action: 'tool_load', lane: 'lane4' }, readyState({ afc: afc(), toolhead: { homedAxes: 'xy' } })))).toMatch(
      /Home the printer/,
    );
    expect(blocked(prepareCommand({ kind: 'afc', action: 'change_tool', lane: 'lane4' }, readyState({ transport: 'waiting', status: 'disconnected', afc: afc() })))).toBe(
      'Printer is offline',
    );
  });
});

describe('AFC route', () => {
  it('keeps the existing rail unless AFC is installed', () => {
    expect(navItems(false).map((item) => item.id)).toEqual(ROUTES.map((item) => item.id));
    expect(navItems(true).map((item) => item.id)).toEqual(['home', 'files', 'move', 'heat', 'extrude', 'afc', 'fans', 'macros', 'console', 'settings']);
    expect(parseRoute('#/afc')).toBe('afc');
    expect(parseRoute('#/nope')).toBe('home');
  });
});
