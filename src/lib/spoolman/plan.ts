import type { CommandPlan, Prepared } from '../actions/commands';
import type { MacroInfo, PrinterState } from '../printer/model';
import type { SpoolmanFacts } from './types';

const MACRO_NAME_RE = /^[A-Z0-9_]+$/;
const SECOND = 1000;
/** Same bound as other Klipper macros. An unload can heat and move. */
const UNLOAD_TIMEOUT_MS = 15 * 60_000;

function fail(message: string): Prepared {
  return { ok: false, message };
}

function ok(plan: CommandPlan): Prepared {
  return { ok: true, plan };
}

export type SpoolmanCommand =
  | { kind: 'set_active_spool'; spoolId: number }
  | { kind: 'clear_active_spool'; authorized?: boolean }
  | { kind: 'unload_for_spool_clear'; macro: string };

function jobActive(state: PrinterState): boolean {
  return state.job?.state === 'printing' || state.job?.state === 'paused';
}

function gate(state: PrinterState, facts: SpoolmanFacts | null): string | null {
  if (state.status === 'unconfigured') return 'Set up the printer connection in Settings';
  if (state.transport !== 'connected') return 'Printer is offline';
  if (state.klippy !== 'ready') return 'Klipper is not ready';
  if (jobActive(state)) return `A print is active on ${state.printerName}. Spool changes stay locked until it finishes.`;
  if (!facts || facts.phase !== 'ready' || facts.printerId !== state.printerId) {
    return facts?.message || 'Spoolman is not available on this printer';
  }
  return null;
}

/**
 * Active-spool writes. Printing and paused jobs stay locked. The unload macro is whichever
 * parameter-free unload macro this printer actually reports; the spool is not cleared here.
 */
export function prepareSpoolmanCommand(command: SpoolmanCommand, state: PrinterState, facts: SpoolmanFacts | null): Prepared {
  const blocked = gate(state, command.kind === 'unload_for_spool_clear' ? facts : facts);
  if (blocked) return fail(blocked);
  if (command.kind === 'unload_for_spool_clear') return prepareUnload(command.macro, state);
  if (!facts) return fail('Spoolman is not available on this printer');
  if (command.kind === 'set_active_spool') return prepareSet(command.spoolId, facts, state.printerName);
  return prepareClear(Boolean(command.authorized), facts, state.printerName);
}

function prepareSet(spoolId: number, facts: SpoolmanFacts, label: string): Prepared {
  if (!Number.isInteger(spoolId)) return fail('Choose a spool');
  if (!facts.ids.includes(spoolId)) return fail("That spool is not in this printer's list");
  if (facts.activeKnown && facts.activeId === spoolId) return fail('That spool is already active');
  const name = facts.names[spoolId] || `Spool ${spoolId}`;
  const archived = facts.archived.includes(spoolId);
  const body = `Use ${name} as the active spool on ${label}. Filament tracking follows this spool.${archived ? ' This spool is archived.' : ''}`;
  return ok({
    method: 'server.spoolman.post_spool_id',
    params: { spool_id: spoolId },
    timeoutMs: 15 * SECOND,
    summary: `Active spool ${name}`,
    group: 'spoolman',
    note: null,
    confirm: {
      title: `Set active spool on ${label}?`,
      body,
      confirmLabel: 'Set active spool',
      cancelLabel: 'Go back',
      tone: archived ? 'warn' : 'primary',
    },
  });
}

function prepareClear(authorized: boolean, facts: SpoolmanFacts, label: string): Prepared {
  if (!facts.activeKnown) {
    return fail(
      authorized
        ? 'Unload finished. The active spool was not read, so it was kept. Clear it from Spools after you check the printer.'
        : 'The active spool has not been read',
    );
  }
  if (facts.activeId === null) {
    return fail(authorized ? 'Unload finished. No active spool was set, so nothing was cleared.' : 'No active spool is set');
  }
  const body = authorized
    ? `Klipper accepted the unload on ${label}. Clear the active spool now. This does not move filament.`
    : `Stop tracking the active spool on ${label}. This does not move filament. Use it after you have checked an unload yourself.`;
  return ok({
    method: 'server.spoolman.post_spool_id',
    params: { spool_id: null },
    timeoutMs: 15 * SECOND,
    summary: 'Clear active spool',
    group: 'spoolman',
    note: null,
    confirm: {
      title: `Clear the active spool on ${label}?`,
      body,
      confirmLabel: 'Clear active spool',
      cancelLabel: 'Keep spool',
      tone: 'warn',
    },
  });
}

function prepareUnload(name: string, state: PrinterState): Prepared {
  const macro = state.macros.find((item) => item.name === name) ?? null;
  if (!macro || !MACRO_NAME_RE.test(name)) return fail('This macro is not available');
  const required = macro.requiredParams;
  if (required.length > 0) return fail(`${name} needs ${required.join(', ')}. LAYR will not guess them, and the active spool was kept.`);
  const label = state.printerName;
  return ok({
    method: 'printer.gcode.script',
    params: { script: name },
    timeoutMs: UNLOAD_TIMEOUT_MS,
    summary: `Run ${name}`,
    group: 'spoolman',
    note: null,
    confirm: {
      title: `Unload with ${name}?`,
      body: `Run ${name} on ${label}. The active spool is cleared only if Klipper accepts this macro. A failed, cancelled, or unanswered run keeps the spool.`,
      confirmLabel: 'Run and clear if accepted',
      cancelLabel: 'Go back',
      tone: 'warn',
    },
  });
}

export function unloadMacro(macros: readonly MacroInfo[], candidates: readonly string[]): MacroInfo | null {
  for (const name of candidates) {
    const macro = macros.find((item) => item.name === name && item.requiredParams.length === 0);
    if (macro && MACRO_NAME_RE.test(macro.name)) return macro;
  }
  return null;
}
