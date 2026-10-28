/**
 * Spoolman data for one printer. Reads use Moonraker `server.spoolman.status`,
 * `server.spoolman.get_spool_id` and `server.spoolman.proxy` (GET `/v1/spool` only).
 * Writes use `server.spoolman.post_spool_id` and always go through `CommandGateway`.
 *
 * The active spool is cleared only after an unload Klipper has accepted. A failed,
 * cancelled, or unanswered unload keeps the spool.
 */

export interface SpoolSummary {
  id: number;
  name: string;
  material: string | null;
  vendor: string | null;
  /** Hex colour without `#`, as stored by Spoolman. Null when Spoolman sent none. */
  colorHex: string | null;
  /** CSS colours (`#rrggbb`) derived from Spoolman. Empty when none were usable. */
  colors: string[];
  remainingWeightG: number | null;
  /** Remaining length in millimetres, when Spoolman sent `remaining_length`. */
  remainingLengthMm: number | null;
  usedWeightG: number | null;
  spoolWeightG: number | null;
  archived: boolean;
  location: string | null;
  lot: string | null;
}

export type UnloadOutcome = { kind: 'confirmed-success' } | { kind: 'failed'; reason: string } | { kind: 'cancelled' } | { kind: 'unconfirmed'; reason: string };

export type SpoolmanPhase = 'unknown' | 'loading' | 'ready' | 'offline' | 'absent' | 'error' | 'stale';

/** Facts `prepareCommand` needs. No weights: those stay on the catalogue and are cleared when the link drops. */
export interface SpoolmanFacts {
  printerId: string;
  phase: SpoolmanPhase;
  activeKnown: boolean;
  activeId: number | null;
  ids: number[];
  /** Spool id → display name for the spools currently loaded for this printer. */
  names: Record<number, string>;
  archived: number[];
  message: string | null;
}

export interface SpoolmanService {
  listSpools(printerId: string): Promise<SpoolSummary[]>;
  getActiveSpool(printerId: string): Promise<SpoolSummary | null>;
  setActiveSpool(printerId: string, spoolId: number): Promise<void>;
  /** Must only clear when `outcome.kind === 'confirmed-success'`. */
  clearActiveSpoolAfterUnload(printerId: string, outcome: UnloadOutcome): Promise<void>;
}

export type SpoolmanNotice =
  | { kind: 'link'; connected: boolean | null }
  | { kind: 'active'; spoolId: number | null };

export function emptySpoolmanFacts(printerId: string, phase: SpoolmanPhase = 'unknown', message: string | null = null): SpoolmanFacts {
  return { printerId, phase, activeKnown: false, activeId: null, ids: [], names: {}, archived: [], message };
}

/** Clear the tracked spool only after Klipper has accepted the unload. */
export function shouldClearAfterUnload(outcome: UnloadOutcome): boolean {
  return outcome.kind === 'confirmed-success';
}
