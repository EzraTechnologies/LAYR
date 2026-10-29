import { describe, expect, it } from 'vitest';
import { prepareCommand } from '../src/lib/actions/commands';
import { mapMmu, mmuSubscriptionObjects } from '../src/lib/mmu/map';
import type { MmuSnapshot } from '../src/lib/mmu/types';
import { planSubscription } from '../src/lib/moonraker/objects';
import { assembleState, type AssembleInputs } from '../src/lib/printer/assemble';
import { visibleRoutes } from '../src/lib/routes';
import { readyState, withJob } from './stateFixture';

const HELP = new Set([
  'MMU_HOME',
  'MMU_SELECT',
  'MMU_SELECT_BYPASS',
  'MMU_CHANGE_TOOL',
  'MMU_LOAD',
  'MMU_UNLOAD',
  'MMU_EJECT',
  'MMU_PRELOAD',
  'MMU_CHECK_GATE',
  'MMU_RECOVER',
  'MMU_UNLOCK',
]);

function mmuState(patch: Partial<MmuSnapshot> = {}) {
  const snapshot: MmuSnapshot = {
    enabled: true,
    version: '4.0.0',
    numGates: 4,
    homed: true,
    printState: 'idle',
    tool: 1,
    gate: 1,
    filament: 'Loaded',
    action: 'Idle',
    operation: null,
    reasonForPause: null,
    hasBypass: true,
    ttgMap: [0, 1, 2, 3],
    activeName: 'Galaxy Orange',
    activeMaterial: 'ASA',
    units: [{ name: 'ERCF', firstGate: 0, gateCount: 4 }],
    gates: [0, 1, 2, 3].map((index) => ({
      index,
      tool: index,
      unit: 'ERCF',
      filamentName: null,
      material: 'PLA',
      color: null,
      colorName: null,
      status: 1,
      spoolId: null,
      temperatureC: null,
    })),
    ...patch,
  };
  return readyState({ mmu: snapshot });
}

function prepared(command: Parameters<typeof prepareCommand>[0], state = mmuState(), help: ReadonlySet<string> | null = HELP) {
  return prepareCommand(command, state, { spoolman: null, gcodeCommands: help });
}

function script(command: Parameters<typeof prepareCommand>[0], state = mmuState(), help: ReadonlySet<string> | null = HELP) {
  const result = prepared(command, state, help);
  if (!result.ok) throw new Error(result.message);
  return result.plan.params?.script;
}

function blocked(command: Parameters<typeof prepareCommand>[0], state = mmuState(), help: ReadonlySet<string> | null = HELP) {
  const result = prepared(command, state, help);
  return result.ok ? null : result.message;
}

describe('Happy Hare status mapping', () => {
  it('stays absent without an mmu object and ignores stepper objects', () => {
    expect(mapMmu({}, ['extruder'])).toBeNull();
    expect(mmuSubscriptionObjects(['mmu', 'mmu_machine', 'mmu_stepper gear', 'extruder'])).toEqual(['mmu', 'mmu_machine']);
    const plan = planSubscription(['extruder', 'mmu', 'mmu_machine', 'mmu_stepper gear']);
    expect(plan.objects.mmu).toBeNull();
    expect(plan.objects.mmu_machine).toBeNull();
    expect(plan.objects).not.toHaveProperty('mmu_stepper gear');
  });

  it('maps reported fields and leaves missing ones null', () => {
    const snapshot = mapMmu(
      {
        mmu: {
          enabled: true,
          is_homed: false,
          print_state: 'idle',
          tool: -1,
          gate: 0,
          filament: 'Unknown',
          num_gates: 2,
          gate_status: [1],
          gate_material: ['PLA', 'ASA'],
          gate_color: ['', 'blue'],
          gate_color_rgb: [[1, 0.416, 0]],
          ttg_map: [1, 0],
        },
        mmu_machine: { happy_hare_version: '4.0.0', unit_0: { display_name: 'ERCF', first_gate: 0, num_gates: 2, has_bypass: true } },
      },
      ['mmu', 'mmu_machine'],
    );
    expect(snapshot?.version).toBe('4.0.0');
    expect(snapshot?.homed).toBe(false);
    expect(snapshot?.tool).toBe(-1);
    expect(snapshot?.hasBypass).toBe(true);
    expect(snapshot?.gates).toHaveLength(2);
    expect(snapshot?.gates[0]).toMatchObject({ color: '#ff6a00', colorName: null, material: 'PLA', tool: 1, status: 1 });
    expect(snapshot?.gates[1]).toMatchObject({ color: null, colorName: 'blue', material: 'ASA', tool: 0, status: null });
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
      raw: { mmu: { print_state: 'idle', num_gates: 1, gate_status: [0] } },
      slicerEstimate: null,
      missingObjects: [],
      objects: ['mmu'],
      settings: {},
      thumbnailPath: null,
      now: 0,
    };
    expect(assembleState(input).mmu?.printState).toBe('idle');
    expect(assembleState({ ...input, klippy: 'shutdown' }).mmu).toBeNull();
  });
});

describe('Happy Hare commands', () => {
  it('sends exactly MMU_CHANGE_TOOL TOOL= for the mapped tool', () => {
    const result = prepared({ kind: 'mmu_change_tool', gate: 0 }, mmuState({ ttgMap: [2, 0, 1, 3] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.params).toEqual({ script: 'MMU_CHANGE_TOOL TOOL=1' });
    expect(result.plan.confirm?.confirmLabel).toBe('Change tool');
  });

  it('uses the older select command when MMU_SELECT is absent', () => {
    expect(script({ kind: 'mmu_select', gate: 0 }, mmuState(), new Set(['MMU_SELECT_TOOL']))).toBe('MMU_SELECT_TOOL TOOL=0');
    expect(script({ kind: 'mmu_load' }, mmuState(), new Set(['MMU_LOAD_TOOL']))).toBe('MMU_LOAD_TOOL');
    expect(script({ kind: 'mmu_unload' }, mmuState(), new Set(['MMU_UNLOAD_TOOL']))).toBe('MMU_UNLOAD_TOOL');
    expect(script({ kind: 'mmu_eject' }, mmuState(), new Set(['MMU_EJECT_TOOL']))).toBe('MMU_EJECT_TOOL');
  });

  it('prefers the current command names and sends no extra parameters', () => {
    expect(script({ kind: 'mmu_select', gate: 0 })).toBe('MMU_SELECT GATE=0');
    expect(script({ kind: 'mmu_home' })).toBe('MMU_HOME');
    expect(script({ kind: 'mmu_load' })).toBe('MMU_LOAD');
    expect(script({ kind: 'mmu_bypass' })).toBe('MMU_SELECT BYPASS=1');
    expect(script({ kind: 'mmu_bypass' }, mmuState(), new Set(['MMU_SELECT_BYPASS']))).toBe('MMU_SELECT_BYPASS');
  });

  it('refuses filament moves while printing, paused, busy, unhomed, or unknown', () => {
    expect(blocked({ kind: 'mmu_change_tool', gate: 0 }, withJob(mmuState(), 'printing'))).toMatch(/print is active/);
    expect(blocked({ kind: 'mmu_load' }, mmuState({ printState: 'printing' }))).toMatch(/Filament moves stay locked/);
    expect(blocked({ kind: 'mmu_home' }, withJob(mmuState(), 'paused'))).toMatch(/paused/);
    expect(blocked({ kind: 'mmu_change_tool', gate: 0 }, mmuState({ action: 'Loading' }))).toMatch(/Loading/);
    const unhomed = mmuState({ homed: false });
    expect(blocked({ kind: 'mmu_load' }, unhomed)).toMatch(/Home the MMU/);
    expect(script({ kind: 'mmu_home' }, unhomed)).toBe('MMU_HOME');
    expect(blocked({ kind: 'mmu_change_tool', gate: 9 })).toMatch(/not on this printer/);
    expect(blocked({ kind: 'mmu_change_tool', gate: 0 }, mmuState(), null)).toMatch(/have not been read/);
    expect(blocked({ kind: 'mmu_change_tool', gate: 0 }, mmuState(), new Set(['MMU_SELECT']))).toMatch(/not on this printer/);
    expect(blocked({ kind: 'mmu_select', gate: 1 })).toMatch(/already selected/);
    expect(blocked({ kind: 'mmu_bypass' }, mmuState({ hasBypass: false }))).toMatch(/no bypass/);
  });

  it('allows recover and unlock only in the documented pause states', () => {
    const paused = mmuState({ printState: 'pause_locked', reasonForPause: 'encoder' });
    expect(blocked({ kind: 'mmu_change_tool', gate: 0 }, paused)).toMatch(/Only recover and unlock/);
    expect(script({ kind: 'mmu_recover' }, paused)).toBe('MMU_RECOVER');
    const unlock = prepared({ kind: 'mmu_unlock' }, paused);
    expect(unlock.ok).toBe(true);
    if (!unlock.ok) return;
    expect(unlock.plan.params).toEqual({ script: 'MMU_UNLOCK' });
    expect(unlock.plan.confirm?.body).toMatch(/does not resume/);
    expect(blocked({ kind: 'mmu_unlock' })).toMatch(/only available while Happy Hare is paused/);
    expect(blocked({ kind: 'mmu_unlock' }, withJob(mmuState({ printState: 'error' }), 'printing'))).toMatch(/printing/);
    expect(script({ kind: 'mmu_recover' }, mmuState({ printState: 'error' }))).toBe('MMU_RECOVER');
  });

  it('hides the nav item until an mmu object exists', () => {
    expect(visibleRoutes({ spoolman: false }).some((route) => route.id === 'mmu')).toBe(false);
    expect(visibleRoutes({ spoolman: false, mmu: true }).some((route) => route.id === 'mmu')).toBe(true);
  });
});
