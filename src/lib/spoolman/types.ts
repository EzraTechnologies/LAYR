/**
 * Spoolman integration for the Chromium app. Reads use Moonraker's documented Spoolman methods.
 * Writes go through `CommandGateway` and are scoped to one `PrinterProfile`.
 *
 * Workflow:
 *  1. Browse spools (`server.spoolman.proxy` → Spoolman `GET /v1/spool`).
 *  2. Select the active spool (`server.spoolman.post_spool_id`) only after confirmation.
 *  3. Clear the active spool only after an unload Klipper has accepted
 *     (`server.spoolman.post_spool_id` with `spool_id: null`). A failed, unconfirmed, or
 *     cancelled unload keeps the spool.
 *
 * The unload outcome maps to the gateway result: only `status: 'ok'` (Klipper replied "ok"
 * to the unload macro) counts as `confirmed-success`.
 */

export interface SpoolSummary {
  id: number;
  name: string;
  material: string | null;
  vendor: string | null;
  /** Hex colour without `#`, as stored by Spoolman. Null when Spoolman did not send a usable colour. */
  colorHex: string | null;
  /** Grams remaining. Null when Spoolman omitted `remaining_weight`. */
  remainingWeightG: number | null;
  /** Millimetres remaining. Null when Spoolman omitted `remaining_length`. */
  remainingLengthMm: number | null;
  archived: boolean;
}

export type UnloadOutcome =
  | { kind: 'confirmed-success' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unconfirmed'; reason: string }
  | { kind: 'cancelled' };

export interface SpoolmanService {
  listSpools(printerId: string): Promise<SpoolSummary[]>;
  getActiveSpool(printerId: string): Promise<SpoolSummary | null>;
  setActiveSpool(printerId: string, spoolId: number): Promise<void>;
  /** Must only clear when `outcome.kind === 'confirmed-success'`. */
  clearActiveSpoolAfterUnload(printerId: string, outcome: UnloadOutcome): Promise<void>;
}
