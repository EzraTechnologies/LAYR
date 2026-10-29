import type { CommandPlan, Prepared } from '../actions/commands';
import type { PrinterState } from '../printer/model';
import type { AfcCommand } from './types';

const LANE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IDLE_STATES = new Set(['idle', 'ready', 'unknown', 'initialized', 'standby', '']);
const SECOND = 1000;
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

/**
 * Documented AFC motions: `CHANGE_TOOL`, `TOOL_LOAD`, `TOOL_UNLOAD`, and `AFC_CLEAR_MESSAGE`.
 * A command is offered only when `printer.gcode.help` lists it. Printing, errors, and an in-progress
 * AFC state stay locked. Clearing a message does not move filament.
 */
export function prepareAfcCommand(command: AfcCommand, state: PrinterState, gcodeCommands: ReadonlySet<string> | null): Prepared {
  if (state.status === 'unconfigured') return fail('Set up the printer connection in Settings');
  if (state.transport !== 'connected') return fail('Printer is offline');
  if (state.klippy !== 'ready') return fail('Klipper is not ready');
  const afc = state.afc;
  if (!afc) return fail('AFC is not available on this printer');
  if (gcodeCommands === null) return fail('AFC commands have not been read yet');

  if (command.kind === 'afc_clear_message') {
    if (!hasCommand(gcodeCommands, 'AFC_CLEAR_MESSAGE')) return fail('This AFC command is not on this printer');
    if (!afc.message) return fail('AFC has no message to clear');
    return ok({
      method: 'printer.gcode.script',
      params: { script: 'AFC_CLEAR_MESSAGE' },
      timeoutMs: 15 * SECOND,
      summary: 'Clear AFC message',
      group: 'afc',
      note: null,
      confirm: {
        title: 'Clear the AFC message?',
        body: 'This only dismisses the message AFC is showing. It does not move filament.',
        confirmLabel: 'Clear message',
        cancelLabel: 'Go back',
        tone: 'primary',
      },
    });
  }

  const locked = motionLock(state, afc.currentState, afc.error);
  if (locked) return fail(locked);

  if (command.kind === 'afc_unload') {
    if (!hasCommand(gcodeCommands, 'TOOL_UNLOAD')) return fail('This AFC command is not on this printer');
    const lane = command.lane;
    if (lane !== null && !laneOk(afc, lane)) return fail('That lane is not on this printer');
    const script = lane ? `TOOL_UNLOAD LANE=${lane}` : 'TOOL_UNLOAD';
    return ok({
      method: 'printer.gcode.script',
      params: { script },
      timeoutMs: MOVE_TIMEOUT_MS,
      summary: lane ? `Unload ${lane}` : 'Unload AFC tool',
      group: 'afc',
      note: null,
      confirm: {
        title: lane ? `Unload ${lane}?` : 'Unload the AFC tool?',
        body: `Run ${script} on ${state.printerName}. This pulls filament out of the toolhead.`,
        confirmLabel: 'Unload',
        cancelLabel: 'Go back',
        tone: 'warn',
      },
    });
  }

  if (!laneOk(afc, command.lane)) return fail('That lane is not on this printer');
  const lane = command.lane;

  if (command.kind === 'afc_change_tool') {
    if (!hasCommand(gcodeCommands, 'CHANGE_TOOL')) return fail('This AFC command is not on this printer');
    if (afc.currentLoad === lane) return fail(`${lane} is already loaded`);
    return ok({
      method: 'printer.gcode.script',
      params: { script: `CHANGE_TOOL LANE=${lane}` },
      timeoutMs: MOVE_TIMEOUT_MS,
      summary: `Change to ${lane}`,
      group: 'afc',
      note: null,
      confirm: {
        title: `Change to ${lane}?`,
        body: `AFC will unload the current lane and load ${lane} on ${state.printerName}. This moves filament.`,
        confirmLabel: 'Change lane',
        cancelLabel: 'Go back',
        tone: 'warn',
      },
    });
  }

  if (!hasCommand(gcodeCommands, 'TOOL_LOAD')) return fail('This AFC command is not on this printer');
  return ok({
    method: 'printer.gcode.script',
    params: { script: `TOOL_LOAD LANE=${lane}` },
    timeoutMs: MOVE_TIMEOUT_MS,
    summary: `Load ${lane}`,
    group: 'afc',
    note: null,
    confirm: {
      title: `Load ${lane}?`,
      body: `Run TOOL_LOAD LANE=${lane} on ${state.printerName}. This feeds that lane into the toolhead.`,
      confirmLabel: 'Load lane',
      cancelLabel: 'Go back',
      tone: 'warn',
    },
  });
}

export function afcMotionLocked(state: PrinterState): string | null {
  if (!state.afc) return 'AFC is not available on this printer';
  return motionLock(state, state.afc.currentState, state.afc.error);
}

function motionLock(state: PrinterState, currentState: string | null, error: boolean | null): string | null {
  if (state.job?.state === 'printing' || state.job?.state === 'paused') {
    return `A print is active on ${state.printerName}. AFC lane changes stay locked until it finishes.`;
  }
  const homed = state.toolhead?.homedAxes ?? '';
  if (!homed.includes('x') || !homed.includes('y') || !homed.includes('z')) return 'Home the printer before moving AFC filament';
  if (error === true) return 'AFC is reporting an error. Clear it on the printer before moving filament.';
  if (currentState !== null && !IDLE_STATES.has(currentState.trim().toLowerCase())) {
    return `AFC is ${currentState}. Wait until it is idle.`;
  }
  return null;
}

function laneOk(afc: NonNullable<PrinterState['afc']>, lane: string): boolean {
  return LANE_RE.test(lane) && afc.lanes.some((item) => item.name === lane);
}
