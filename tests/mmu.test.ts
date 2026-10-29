import { describe, expect, it } from 'vitest';
import { prepareCommand } from '../src/lib/actions/commands';
import {
  filamentHeadline,
  MMU_CHANGE_TOOL,
  MMU_LOAD,
  mmuCommandsFromHelp,
  mmuNeedsRecover,
  mmuNotices,
  parseMmu,
  prepareMmuMove,
  slotLabel,
} from '../src/lib/mmu/happyhare';
import { MMU_FIELDS, planSubscription } from '../src/lib/moonraker/objects';
import { assembleState, type AssembleInputs } from '../src/lib/printer/assemble';
import { readyState, withJob } from './stateFixture';

const COMMANDS = ['MMU_LOAD', 'MMU_UNLOAD', 'MMU_CHANGE_TOOL', 'MMU_RECOVER'];

function loadedMmu() {
  return {
    enabled: true,
    num_gates: 5,
    is_homed: true,
    print_state: 'ready',
    tool: 1,
    gate: 2,
    last_tool: 0,
    next_tool: -1,
    filament: 'Loaded',
    filament_pos: 10,
    filament_position: 842.5,
    action: 'Idle',
    reason_for_pause: '',
    ttg_map: [0, 2, 1, 3, 4],
    gate_status: [1, 0, 1, 2, -1],
    gate_filament_name: ['Galaxy Black', '', 'PolyLite', 'Buffer PLA', ''],
    gate_material: ['ASA', '', 'PLA', 'PLA', ''],
    gate_color: ['#2a2a2a', '', 'red', '#fbbf24', ''],
    gate_color_rgb: [
      [0.16, 0.16, 0.16],
      [0, 0, 0],
      [1, 0, 0],
      [0.984, 0.749, 0.141],
      [0, 0, 0],
    ],
    gate_temperature: [250, 0, 210, 0, 0],
    gate_spool_id: [12, -1, 0, -1, -1],
  };
}

describe('planSubscription', () => {
  it('leaves printers without an mmu object unchanged', () => {
    const plan = planSubscription(['extruder', 'AFC', 'mmu_machine', 'print_stats']);
    expect(plan.objects.mmu).toBeUndefined();
    expect(plan.objects.AFC).toBeUndefined();
  });

  it('subscribes only to the documented Happy Hare fields', () => {
    const plan = planSubscription(['extruder', 'mmu']);
    expect(plan.objects.mmu).toEqual([...MMU_FIELDS]);
    expect(plan.objects.mmu).not.toContain('nfc');
    expect(plan.missing).not.toContain('mmu');
  });
});

describe('parseMmu', () => {
  it('reads the selected tool and gate, and does not treat a bowden distance as a position code', () => {
    const mmu = parseMmu(loadedMmu(), COMMANDS);
    expect(mmu.tool).toBe(1);
    expect(mmu.gate).toBe(2);
    expect(mmu.filament).toBe('Loaded');
    expect(mmu.filamentPos).toBe(10);
    expect(filamentHeadline(mmu)).toBe('Loaded in nozzle');
    expect(mmu.gates).toHaveLength(5);
    expect(mmu.gates[2]).toMatchObject({
      index: 2,
      status: 'available',
      material: 'PLA',
      filamentName: 'PolyLite',
      color: '#ff0000',
      temperature: 210,
      tools: [1],
    });
    expect(mmu.gates[1]).toMatchObject({ status: 'empty', spoolId: null, temperature: null, color: null });
    expect(mmu.gates[3]).toMatchObject({ status: 'buffer', color: '#fbbf24' });
    expect(mmu.gates[4]?.status).toBe('unknown');
    expect(mmu.gates[0]?.spoolId).toBe(12);
    expect(mmu.commands).toEqual(COMMANDS);
  });

  it('keeps an older build usable when arrays and print_state are absent', () => {
    const mmu = parseMmu(
      { enabled: true, tool: 0, gate: 0, filament_position: 3, is_paused: true, action: 'Idle' },
      ['MMU_LOAD'],
    );
    expect(mmu.printState).toBeNull();
    expect(mmu.paused).toBe(true);
    expect(mmu.filamentPos).toBe(3);
    expect(filamentHeadline(mmu)).toBe('In bowden');
    expect(mmu.numGates).toBeNull();
    expect(mmu.gates).toEqual([]);
    expect(mmu.commands).toEqual(['MMU_LOAD']);
    expect(mmuNotices(mmu).map((notice) => notice.text)).toContain('Happy Hare reports the MMU is paused');
    expect(mmuNotices(mmu).map((notice) => notice.text)).toContain('Gate count was not reported');
  });

  it('does not invent gates, colors, or commands from empty or garbage fields', () => {
    const mmu = parseMmu(
      {
        tool: 'nope',
        gate: null,
        num_gates: -3,
        filament: 'maybe',
        gate_status: 'bad',
        gate_color: ['', 'not-a-color'],
        gate_color_rgb: [[0, 0, 0], [2, -1, 4]],
        ttg_map: { 0: 1 },
      },
      null,
    );
    expect(mmu.tool).toBeNull();
    expect(mmu.gate).toBeNull();
    expect(mmu.numGates).toBeNull();
    expect(mmu.gates).toEqual([]);
    expect(mmu.filament).toBeNull();
    expect(mmu.filamentRaw).toBe('maybe');
    expect(mmu.ttgReported).toBe(false);
    expect(mmu.commands).toBeNull();
    expect(slotLabel('Tool', mmu.tool)).toBe('Tool not reported');
    expect(mmuNotices(mmu).map((notice) => notice.text)).toContain('Command list unavailable. No MMU moves are offered');
  });

  it('names bypass and an unknown selection without treating them as gate indexes', () => {
    const mmu = parseMmu({ tool: -2, gate: -1, filament: 'Unknown', filament_pos: -1, enabled: true, num_gates: 4 }, []);
    expect(slotLabel('Tool', mmu.tool)).toBe('Bypass');
    expect(slotLabel('Gate', mmu.gate)).toBe('Gate Unknown');
    expect(mmuNeedsRecover(mmu)).toBe(true);
    expect(mmu.commands).toEqual([]);
  });

  it('caps a long gate list and still shows the selected gate', () => {
    const mmu = parseMmu(
      {
        num_gates: 20,
        gate: 18,
        tool: 18,
        gate_status: Array.from({ length: 20 }, () => 1),
        ttg_map: Array.from({ length: 20 }, (_, i) => i),
      },
      COMMANDS,
    );
    expect(mmu.gates).toHaveLength(16);
    expect(mmu.hiddenGates).toBe(4);
    expect(mmu.gates.some((gate) => gate.index === 18)).toBe(true);
  });

  it('reports a disagreement between the filament word and the position code', () => {
    const mmu = parseMmu({ filament: 'Loaded', filament_pos: 3, enabled: true, num_gates: 1 }, COMMANDS);
    expect(mmu.filamentDisagreement).toBe(true);
    expect(filamentHeadline(mmu)).toBe('In bowden');
  });

  it('reads help keys and ignores every other registered command', () => {
    expect(mmuCommandsFromHelp({ MMU_UNLOAD: 'u', G28: 'home', MMU_RESET: 'reset' })).toEqual(['MMU_UNLOAD']);
    expect(mmuCommandsFromHelp(null)).toBeNull();
    expect(mmuCommandsFromHelp(['MMU_LOAD'])).toBeNull();
  });
});

describe('prepareMmuMove', () => {
  const mmu = parseMmu(loadedMmu(), COMMANDS);

  function plan(result: ReturnType<typeof prepareMmuMove>) {
    if (!result.ok) throw new Error(result.message);
    return result.plan;
  }

  it('sends the documented command and nothing else', () => {
    expect(plan(prepareMmuMove({ action: 'load' }, { mmu, jobState: null })).script).toBe('MMU_LOAD');
    expect(plan(prepareMmuMove({ action: 'unload' }, { mmu, jobState: null })).script).toBe('MMU_UNLOAD');
    expect(plan(prepareMmuMove({ action: 'recover' }, { mmu, jobState: null })).script).toBe('MMU_RECOVER');
    expect(plan(prepareMmuMove({ action: 'change_tool', tool: 3 }, { mmu, jobState: null })).script).toBe(
      'MMU_CHANGE_TOOL TOOL=3',
    );
    expect(plan(prepareMmuMove({ action: 'load' }, { mmu, jobState: null })).body).toContain('Nothing is sent until you confirm.');
  });

  it('blocks printing, a missing MMU, a disabled unit, and a busy action', () => {
    expect(prepareMmuMove({ action: 'load' }, { mmu: null, jobState: null })).toEqual({
      ok: false,
      message: 'No Happy Hare MMU is connected',
    });
    expect(prepareMmuMove({ action: 'load' }, { mmu, jobState: 'printing' }).ok).toBe(false);
    expect(prepareMmuMove({ action: 'change_tool', tool: 0 }, { mmu: { ...mmu, printState: 'started' }, jobState: 'standby' })).toMatchObject({
      ok: false,
      message: 'Not available while printing',
    });
    expect(prepareMmuMove({ action: 'load' }, { mmu: { ...mmu, enabled: false }, jobState: null })).toMatchObject({
      message: 'Happy Hare reports the MMU is disabled',
    });
    expect(prepareMmuMove({ action: 'unload' }, { mmu: { ...mmu, action: 'Loading' }, jobState: null })).toMatchObject({
      message: 'Happy Hare is busy (Loading)',
    });
  });

  it('refuses a tool change that is not registered, out of range, or already selected', () => {
    expect(prepareMmuMove({ action: 'load' }, { mmu: { ...mmu, commands: null }, jobState: null })).toMatchObject({
      message: 'Happy Hare command list is unavailable',
    });
    expect(prepareMmuMove({ action: 'load' }, { mmu: { ...mmu, commands: [] }, jobState: null })).toMatchObject({
      message: 'MMU_LOAD is not registered on this printer',
    });
    expect(prepareMmuMove({ action: 'change_tool', tool: 1 }, { mmu, jobState: null })).toMatchObject({
      message: 'Tool 1 is already selected',
    });
    expect(prepareMmuMove({ action: 'change_tool', tool: 9 }, { mmu, jobState: null })).toMatchObject({
      message: 'Tool 9 is outside 0–4',
    });
    expect(prepareMmuMove({ action: 'change_tool', tool: 1.5 }, { mmu, jobState: null }).ok).toBe(false);
  });

  it('warns while paused and still asks before recover', () => {
    const paused = parseMmu({ ...loadedMmu(), print_state: 'pause_locked', reason_for_pause: 'Clog on gate 2', filament: 'Unknown', filament_pos: -1 }, COMMANDS);
    const result = prepareMmuMove({ action: 'recover' }, { mmu: paused, jobState: 'paused' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.script).toBe('MMU_RECOVER');
    expect(result.plan.tone).toBe('warn');
    expect(result.plan.body).toContain('A print is paused.');
    expect(result.plan.body).toContain('Filament position is unknown.');
    expect(result.plan.body).not.toContain('LOADED=');
  });

  it('goes through prepareCommand with the same script and an offline gate', () => {
    const state = readyState({ mmu });
    const prepared = prepareCommand({ kind: 'mmu', action: 'change_tool', tool: 0 }, state);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.plan.params).toEqual({ script: `${MMU_CHANGE_TOOL} TOOL=0` });
    expect(prepared.plan.confirm?.confirmLabel).toBe('Change tool');
    expect(prepared.plan.group).toBe('mmu');

    const offline = prepareCommand({ kind: 'mmu', action: 'load' }, readyState({ mmu, transport: 'waiting', status: 'disconnected' }));
    expect(offline.ok).toBe(false);
    if (offline.ok) return;
    expect(offline.message).toBe('Printer is offline');

    const printing = prepareCommand({ kind: 'mmu', action: 'load' }, withJob(state, 'printing'));
    expect(printing.ok).toBe(false);
  });
});

describe('assembleState mmu', () => {
  const base: AssembleInputs = {
    printerId: 'p1',
    configuredName: 'Trident',
    hostname: 'voron',
    transport: 'connected',
    klippy: 'ready',
    klippyMessage: null,
    reconnectAttempt: 0,
    nextRetryAt: null,
    transportReason: null,
    raw: { mmu: loadedMmu(), extruder: { temperature: 200, target: 200, power: 0 } },
    slicerEstimate: null,
    missingObjects: [],
    objects: ['mmu', 'extruder'],
    settings: {},
    thumbnailPath: null,
    gcodeCommands: COMMANDS,
    now: 0,
  };

  it('hides the MMU when the object was not listed', () => {
    expect(assembleState({ ...base, objects: ['extruder'] }).mmu).toBeNull();
  });

  it('drops MMU values when Klipper is shut down or offline', () => {
    expect(assembleState({ ...base, klippy: 'shutdown', klippyMessage: 'MCU shutdown' }).mmu).toBeNull();
    expect(assembleState({ ...base, transport: 'waiting' }).mmu).toBeNull();
  });

  it('keeps the parsed MMU when Klipper is ready', () => {
    expect(assembleState(base).mmu).toMatchObject({ tool: 1, gate: 2, filament: 'Loaded' });
  });
});
