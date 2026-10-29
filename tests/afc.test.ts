import { describe, expect, it, vi } from 'vitest';
import { prepareCommand } from '../src/lib/actions/commands';
import { afcSubscriptionObjects, mapAfc } from '../src/lib/afc/map';
import type { AfcLane, AfcSnapshot } from '../src/lib/afc/types';
import { GcodeHelp } from '../src/lib/integrations/gcodeHelp.svelte';
import { planSubscription } from '../src/lib/moonraker/objects';
import { assembleState, type AssembleInputs } from '../src/lib/printer/assemble';
import type { PrinterConnection } from '../src/lib/printer/source';
import { visibleRoutes } from '../src/lib/routes';
import { readyState, withJob } from './stateFixture';

const HELP = new Set(['CHANGE_TOOL', 'TOOL_LOAD', 'TOOL_UNLOAD', 'AFC_CLEAR_MESSAGE']);

function lane(name: string, patch: Partial<AfcLane> = {}): AfcLane {
  return {
    name,
    object: `AFC_stepper ${name}`,
    unit: 'BoxTurtle',
    hub: 'hub',
    index: null,
    map: null,
    material: null,
    color: null,
    colorName: null,
    weightG: null,
    filamentStatus: null,
    load: null,
    prep: null,
    toolLoaded: null,
    loadedToHub: null,
    spoolId: null,
    runoutLane: null,
    ...patch,
  };
}

function afcState(patch: Partial<AfcSnapshot> = {}) {
  const snapshot: AfcSnapshot = {
    currentLoad: 'lane2',
    currentState: 'Idle',
    error: false,
    bypass: false,
    message: null,
    messageTone: null,
    units: ['BoxTurtle'],
    hubs: ['hub'],
    buffers: [],
    extruders: ['extruder'],
    lanes: [lane('lane1', { map: 'T0' }), lane('lane2', { map: 'T1' })],
    ...patch,
  };
  return readyState({ afc: snapshot });
}

function script(command: Parameters<typeof prepareCommand>[0], state = afcState(), help: ReadonlySet<string> | null = HELP) {
  const prepared = prepareCommand(command, state, { spoolman: null, gcodeCommands: help });
  if (!prepared.ok) throw new Error(prepared.message);
  return prepared.plan.params?.script;
}

function blocked(command: Parameters<typeof prepareCommand>[0], state = afcState(), help: ReadonlySet<string> | null = HELP) {
  const prepared = prepareCommand(command, state, { spoolman: null, gcodeCommands: help });
  return prepared.ok ? null : prepared.message;
}

describe('AFC status mapping', () => {
  it('stays absent when the printer has no AFC objects', () => {
    expect(mapAfc({ extruder: { temperature: 20 } }, ['extruder'])).toBeNull();
    expect(afcSubscriptionObjects(['extruder', 'gcode_macro PRINT_START'])).toEqual([]);
  });

  it('maps reported fields and leaves missing ones null', () => {
    const snapshot = mapAfc(
      {
        AFC: {
          current_load: 'lane2',
          current_state: 'Idle',
          error_state: false,
          bypass_state: true,
          message: { message: 'Hub jam', type: 'error' },
          lanes: ['lane2', 'lane9'],
          units: ['BoxTurtle'],
          hubs: ['hub'],
        },
        'AFC_stepper lane2': {
          name: 'lane2',
          unit: 'BoxTurtle',
          lane: 1,
          map: 'T1',
          material: 'ASA',
          color: '#FF6A00',
          weight: 420.4,
          filament_status: 'In Tool',
          load: true,
          spool_id: 7,
        },
      },
      ['AFC', 'AFC_stepper lane2'],
    );
    expect(snapshot?.currentLoad).toBe('lane2');
    expect(snapshot?.error).toBe(false);
    expect(snapshot?.bypass).toBe(true);
    expect(snapshot?.message).toBe('Hub jam');
    expect(snapshot?.messageTone).toBe('error');
    expect(snapshot?.lanes.map((item) => item.name)).toEqual(['lane2', 'lane9']);
    expect(snapshot?.lanes[0]).toMatchObject({
      color: '#ff6a00',
      colorName: null,
      weightG: 420.4,
      filamentStatus: 'In Tool',
      spoolId: 7,
      material: 'ASA',
    });
    expect(snapshot?.lanes[1]).toMatchObject({ name: 'lane9', object: null, filamentStatus: null, weightG: null, color: null });
  });

  it('keeps a colour name and does not treat it as a swatch', () => {
    const snapshot = mapAfc({ 'AFC_lane lane1': { name: 'lane1', color: 'blue' } }, ['AFC_lane lane1']);
    expect(snapshot?.lanes[0]).toMatchObject({ color: null, colorName: 'blue' });
  });

  it('subscribes to AFC objects in full and caps the list', () => {
    const lanes = Array.from({ length: 50 }, (_, index) => `AFC_stepper lane${index}`);
    const plan = planSubscription(['extruder', 'AFC', 'AFC_hub hub', ...lanes]);
    expect(plan.objects.AFC).toBeNull();
    expect(plan.objects['AFC_stepper lane0']).toBeNull();
    expect(plan.objects.extruder).toEqual(['temperature', 'target', 'power', 'can_extrude']);
    const afcKeys = Object.keys(plan.objects).filter((name) => name === 'AFC' || name.startsWith('AFC_'));
    expect(afcKeys).toHaveLength(40);
    expect(afcKeys[0]).toBe('AFC');
  });

  it('drops the snapshot when Klipper is not ready', () => {
    const input: AssembleInputs = {
      printerId: 'p1',
      configuredName: '',
      hostname: 'voron',
      transport: 'connected',
      klippy: 'ready',
      klippyMessage: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
      transportReason: null,
      raw: { AFC: { current_state: 'Idle', lanes: ['lane1'] } },
      slicerEstimate: null,
      missingObjects: [],
      objects: ['AFC'],
      settings: {},
      thumbnailPath: null,
      now: 0,
    };
    expect(assembleState(input).afc?.currentState).toBe('Idle');
    expect(assembleState({ ...input, transport: 'waiting' }).afc).toBeNull();
  });
});

describe('AFC commands', () => {
  it('sends exactly CHANGE_TOOL LANE= when that command is registered', () => {
    const prepared = prepareCommand({ kind: 'afc_change_tool', lane: 'lane1' }, afcState(), { spoolman: null, gcodeCommands: HELP });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.plan.params).toEqual({ script: 'CHANGE_TOOL LANE=lane1' });
    expect(prepared.plan.confirm?.confirmLabel).toBe('Change lane');
  });

  it('refuses motion while printing, paused, unhomed, in error, or busy', () => {
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane1' }, withJob(afcState(), 'printing'))).toMatch(/print is active/);
    expect(blocked({ kind: 'afc_unload', lane: null }, withJob(afcState(), 'paused'))).toMatch(/print is active/);
    const unhomed = afcState();
    unhomed.toolhead = { ...unhomed.toolhead!, homedAxes: 'xy' };
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane1' }, unhomed)).toMatch(/Home the printer/);
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane1' }, afcState({ error: true }))).toMatch(/reporting an error/);
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane1' }, afcState({ currentState: 'Loading' }))).toMatch(/Loading/);
  });

  it('refuses unknown lanes, missing commands, and a help list that has not arrived', () => {
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane9' })).toMatch(/not on this printer/);
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane1; G28' })).toMatch(/not on this printer/);
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane1' }, afcState(), new Set(['TOOL_LOAD']))).toMatch(/not on this printer/);
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane1' }, afcState(), null)).toMatch(/have not been read/);
    expect(blocked({ kind: 'afc_change_tool', lane: 'lane2' })).toMatch(/already loaded/);
    expect(script({ kind: 'afc_load', lane: 'lane1' }, afcState(), new Set(['TOOL_LOAD']))).toBe('TOOL_LOAD LANE=lane1');
    expect(script({ kind: 'afc_unload', lane: null })).toBe('TOOL_UNLOAD');
    expect(script({ kind: 'afc_unload', lane: 'lane2' })).toBe('TOOL_UNLOAD LANE=lane2');
  });

  it('clears a message without moving filament, including during a print', () => {
    const printing = withJob(afcState({ message: 'Hub jam' }), 'printing');
    const prepared = prepareCommand({ kind: 'afc_clear_message' }, printing, { spoolman: null, gcodeCommands: HELP });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.plan.params).toEqual({ script: 'AFC_CLEAR_MESSAGE' });
    expect(blocked({ kind: 'afc_clear_message' }, afcState({ message: null }))).toMatch(/no message/);
    expect(blocked({ kind: 'afc_clear_message' }, afcState({ message: 'Hub jam' }), new Set())).toMatch(/not on this printer/);
  });

  it('hides the nav item until AFC objects exist', () => {
    expect(visibleRoutes({ spoolman: false }).some((route) => route.id === 'afc')).toBe(false);
    const routes = visibleRoutes({ spoolman: true, afc: true }).map((route) => route.id);
    expect(routes.indexOf('afc')).toBe(routes.indexOf('extrude') + 2);
  });
});

describe('gcode help', () => {
  it('keeps registered names and clears them when Klipper drops', async () => {
    let calls = 0;
    const connection = {
      call: async () => {
        calls += 1;
        return { CHANGE_TOOL: 'switch', 'not valid': 'no', '123bad': 'no' };
      },
    } as unknown as PrinterConnection;
    let latest: ReadonlySet<string> | null = new Set(['stale']);
    const help = new GcodeHelp(connection, (names) => {
      latest = names;
    });
    help.observe('connected', 'ready');
    await vi.waitFor(() => expect(help.names).toEqual(['CHANGE_TOOL']));
    expect(latest).toEqual(new Set(['CHANGE_TOOL']));
    help.observe('connected', 'ready');
    expect(calls).toBe(1);
    help.observe('waiting', 'unknown');
    expect(help.names).toBeNull();
    expect(latest).toBeNull();
  });

  it('treats a failed read as an empty command list', async () => {
    const connection = { call: async () => Promise.reject(new Error('offline')) } as unknown as PrinterConnection;
    let latest: ReadonlySet<string> | null = null;
    const help = new GcodeHelp(connection, (names) => {
      latest = names;
    });
    help.observe('connected', 'ready');
    await vi.waitFor(() => expect(help.names).toEqual([]));
    expect(latest).toEqual(new Set());
  });
});
