import type { CommandPlan, Prepared } from '../actions/commands';
import type { PrinterState } from '../printer/model';
import { toolForGate } from './map';
import type { MmuCommand, MmuSnapshot } from './types';

const IDLE_PRINT = new Set(['initialized', 'standby', 'idle', 'ready', 'complete', 'cancelled', '']);
const RECOVERY_PRINT = new Set(['pause_locked', 'error']);
const UNLOCK_PRINT = new Set(['pause_locked', 'paused', 'error']);
const MOVE_TIMEOUT_MS = 15 * 60_000;

function fail(message: string): Prepared {
  return { ok: false, message };
}

function ok(plan: CommandPlan): Prepared {
  return { ok: true, plan };
}

function hasCommand(commands: ReadonlySet<string> | null, name: string): boolean {
  return commands?.has(name) === true;
}

function firstCommand(commands: ReadonlySet<string> | null, names: readonly string[]): string | null {
  return names.find((name) => hasCommand(commands, name)) ?? null;
}

/**
 * Documented Happy Hare user commands. A button exists only when `printer.gcode.help` lists that
 * macro. Newer names win over the older `*_TOOL` aliases. Calibration, test, LED, servo, and reset
 * commands are never built here.
 */
export function prepareMmuCommand(command: MmuCommand, state: PrinterState, gcodeCommands: ReadonlySet<string> | null): Prepared {
  if (state.status === 'unconfigured') return fail('Set up the printer connection in Settings');
  if (state.transport !== 'connected') return fail('Printer is offline');
  if (state.klippy !== 'ready') return fail('Klipper is not ready');
  const mmu = state.mmu;
  if (!mmu) return fail('Happy Hare is not available on this printer');
  if (mmu.enabled === false) return fail('Happy Hare is disabled on this printer');
  if (gcodeCommands === null) return fail('MMU commands have not been read yet');

  if (command.kind === 'mmu_unlock') return prepareUnlock(state, mmu, gcodeCommands);
  if (command.kind === 'mmu_recover') return prepareRecover(state, mmu, gcodeCommands);

  const locked = motionLock(state, mmu);
  if (locked) return fail(locked);
  if (command.kind !== 'mmu_home' && mmu.homed === false) return fail('Home the MMU before moving filament');

  switch (command.kind) {
    case 'mmu_home':
      return commandScript(gcodeCommands, ['MMU_HOME'], 'Home MMU', 'Home the MMU selector?', `Home the MMU on ${state.printerName}. This moves the selector.`, 'Home MMU');
    case 'mmu_load':
      return commandScript(gcodeCommands, ['MMU_LOAD', 'MMU_LOAD_TOOL'], 'Load filament', 'Load the selected gate?', `Load filament from the current Happy Hare gate on ${state.printerName}.`, 'Load');
    case 'mmu_unload':
      return commandScript(gcodeCommands, ['MMU_UNLOAD', 'MMU_UNLOAD_TOOL'], 'Unload filament', 'Unload filament?', `Unload filament from the toolhead on ${state.printerName}.`, 'Unload');
    case 'mmu_eject':
      return commandScript(gcodeCommands, ['MMU_EJECT', 'MMU_EJECT_TOOL'], 'Eject filament', 'Eject the current gate?', `Eject filament from the current gate on ${state.printerName}.`, 'Eject');
    case 'mmu_preload':
      return commandScript(gcodeCommands, ['MMU_PRELOAD'], 'Preload gate', 'Preload the current gate?', `Preload filament into the current gate on ${state.printerName}.`, 'Preload');
    case 'mmu_check_gate':
      return commandScript(gcodeCommands, ['MMU_CHECK_GATE'], 'Check gate', 'Check the current gate?', `Run MMU_CHECK_GATE on ${state.printerName}. This can move filament to test the gate.`, 'Check gate');
    case 'mmu_bypass':
      return prepareBypass(state, mmu, gcodeCommands);
    case 'mmu_select':
      return prepareSelect(state, mmu, gcodeCommands, command.gate);
    case 'mmu_change_tool':
      return prepareChange(state, mmu, gcodeCommands, command.gate);
  }
}

export function mmuMotionLocked(state: PrinterState): string | null {
  if (!state.mmu) return 'Happy Hare is not available on this printer';
  if (state.mmu.enabled === false) return 'Happy Hare is disabled on this printer';
  return motionLock(state, state.mmu);
}

function prepareChange(state: PrinterState, mmu: MmuSnapshot, commands: ReadonlySet<string> | null, gate: number): Prepared {
  if (!hasCommand(commands, 'MMU_CHANGE_TOOL')) return fail('This MMU command is not on this printer');
  const tool = gateTool(mmu, gate);
  if (tool === null) return fail('That gate is not on this printer');
  return ok({
    method: 'printer.gcode.script',
    params: { script: `MMU_CHANGE_TOOL TOOL=${tool}` },
    timeoutMs: MOVE_TIMEOUT_MS,
    summary: `Change to T${tool}`,
    group: 'mmu',
    note: null,
    confirm: {
      title: `Change to T${tool}?`,
      body: `Happy Hare will change to tool ${tool} on ${state.printerName}. This moves filament.`,
      confirmLabel: 'Change tool',
      cancelLabel: 'Go back',
      tone: 'warn',
    },
  });
}

function prepareSelect(state: PrinterState, mmu: MmuSnapshot, commands: ReadonlySet<string> | null, gate: number): Prepared {
  const tool = gateTool(mmu, gate);
  if (tool === null) return fail('That gate is not on this printer');
  if (mmu.gate === gate) return fail(`Gate ${gate} is already selected`);
  if (hasCommand(commands, 'MMU_SELECT')) {
    return ok(movePlan(`MMU_SELECT GATE=${gate}`, `Select gate ${gate}`, `Select gate ${gate}?`, `Move the selector to gate ${gate} on ${state.printerName}. This does not load filament.`, 'Select gate'));
  }
  if (hasCommand(commands, 'MMU_SELECT_TOOL')) {
    return ok(movePlan(`MMU_SELECT_TOOL TOOL=${tool}`, `Select T${tool}`, `Select T${tool}?`, `Select tool ${tool} on ${state.printerName}. This does not load filament.`, 'Select tool'));
  }
  return fail('This MMU command is not on this printer');
}

function prepareBypass(state: PrinterState, mmu: MmuSnapshot, commands: ReadonlySet<string> | null): Prepared {
  if (mmu.hasBypass !== true) return fail('This MMU has no bypass');
  if (mmu.tool === -2) return fail('Bypass is already selected');
  if (hasCommand(commands, 'MMU_SELECT')) {
    return ok(movePlan('MMU_SELECT BYPASS=1', 'Select bypass', 'Select the bypass?', `Select the filament bypass on ${state.printerName}. This does not load filament.`, 'Select bypass'));
  }
  if (hasCommand(commands, 'MMU_SELECT_BYPASS')) {
    return ok(movePlan('MMU_SELECT_BYPASS', 'Select bypass', 'Select the bypass?', `Select the filament bypass on ${state.printerName}. This does not load filament.`, 'Select bypass'));
  }
  return fail('This MMU command is not on this printer');
}

function prepareRecover(state: PrinterState, mmu: MmuSnapshot, commands: ReadonlySet<string> | null): Prepared {
  if (!hasCommand(commands, 'MMU_RECOVER')) return fail('This MMU command is not on this printer');
  if (state.job?.state === 'printing' || printState(mmu) === 'printing' || printState(mmu) === 'started') {
    return fail(`A print is active on ${state.printerName}. MMU recover stays locked until it pauses or finishes.`);
  }
  const recovery = RECOVERY_PRINT.has(printState(mmu));
  if (!recovery) {
    const locked = motionLock(state, mmu);
    if (locked) return fail(locked);
    if (mmu.homed === false) return fail('Home the MMU before moving filament');
  }
  return ok(movePlan('MMU_RECOVER', 'Recover MMU', 'Recover MMU state?', `Run MMU_RECOVER on ${state.printerName}. Happy Hare will re-check where the filament is. This can move filament.`, 'Recover'));
}

function prepareUnlock(state: PrinterState, mmu: MmuSnapshot, commands: ReadonlySet<string> | null): Prepared {
  if (!hasCommand(commands, 'MMU_UNLOCK')) return fail('This MMU command is not on this printer');
  if (state.job?.state === 'printing' || printState(mmu) === 'printing' || printState(mmu) === 'started') {
    return fail(`A print is active on ${state.printerName}. Unlock stays locked while it is printing.`);
  }
  if (!UNLOCK_PRINT.has(printState(mmu))) return fail('Unlock is only available while Happy Hare is paused or in error');
  if (actionBusy(mmu.action)) return fail(`Happy Hare is ${mmu.action}. Wait until it is idle.`);
  return ok({
    method: 'printer.gcode.script',
    params: { script: 'MMU_UNLOCK' },
    timeoutMs: 60_000,
    summary: 'Unlock MMU',
    group: 'mmu',
    note: null,
    confirm: {
      title: 'Unlock Happy Hare?',
      body: `This restores heaters and timeouts on ${state.printerName} after an MMU pause. It does not resume the print and it does not move filament.`,
      confirmLabel: 'Unlock',
      cancelLabel: 'Go back',
      tone: 'primary',
    },
  });
}

function commandScript(commands: ReadonlySet<string> | null, names: readonly string[], summary: string, title: string, body: string, confirmLabel: string): Prepared {
  const name = firstCommand(commands, names);
  if (!name) return fail('This MMU command is not on this printer');
  return ok(movePlan(name, summary, title, body, confirmLabel));
}

function movePlan(script: string, summary: string, title: string, body: string, confirmLabel: string): CommandPlan {
  return {
    method: 'printer.gcode.script',
    params: { script },
    timeoutMs: MOVE_TIMEOUT_MS,
    summary,
    group: 'mmu',
    note: null,
    confirm: { title, body, confirmLabel, cancelLabel: 'Go back', tone: 'warn' },
  };
}

function motionLock(state: PrinterState, mmu: MmuSnapshot): string | null {
  if (state.job?.state === 'printing') return `A print is active on ${state.printerName}. MMU filament moves stay locked until it finishes.`;
  const printed = printState(mmu);
  if (printed === 'printing' || printed === 'started') return `Happy Hare is ${mmu.printState}. Filament moves stay locked until the print is idle.`;
  if (printed === 'pause_locked' || printed === 'error') return `Happy Hare is ${mmu.printState}. Only recover and unlock are available.`;
  if (state.job?.state === 'paused' || printed === 'paused') return `A print is paused on ${state.printerName}. MMU filament moves stay locked.`;
  if (printed && !IDLE_PRINT.has(printed)) return `Happy Hare is ${mmu.printState}. Wait until it is idle.`;
  if (actionBusy(mmu.action)) return `Happy Hare is ${mmu.action}. Wait until it is idle.`;
  return null;
}

function printState(mmu: MmuSnapshot): string {
  return (mmu.printState ?? '').trim().toLowerCase();
}

function actionBusy(action: string | null): boolean {
  if (action === null) return false;
  const value = action.trim().toLowerCase();
  return value !== '' && value !== 'idle' && value !== 'unknown';
}

function gateTool(mmu: MmuSnapshot, gate: number): number | null {
  if (!mmu.gates.some((item) => item.index === gate)) return null;
  return toolForGate(mmu.ttgMap, gate);
}
