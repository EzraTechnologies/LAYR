/**
 * Spoolman integration contract for the Svelte app. The Svelte UI does not call this module.
 * The native Qt Filament screen implements the same rules in `native-qt/` (confirm a write, and
 * clear the active spool only after an unload Klipper has accepted).
 *
 * Planned workflow:
 *  1. Browse available spools (Moonraker `server.spoolman.proxy` → Spoolman `GET /v1/spool`).
 *  2. Select the active spool for a printer (`server.spoolman.post_spool_id`), with confirmation.
 *  3. Clear the active spool only after an unload that the user has confirmed completed successfully
 *     (`server.spoolman.post_spool_id` with `spool_id: null`). A failed or cancelled unload keeps the spool.
 *
 * All of these are write operations and must go through a confirmed `CommandGateway` path and be scoped per
 * `PrinterProfile.id`. The unload outcome maps to the gateway result: only `status: 'ok'` (Klipper replied
 * "ok" to the unload macro) counts as `confirmed-success`; `failed` and `unconfirmed` must keep the spool.
 */

export interface SpoolSummary {
  id: number;
  name: string;
  material: string | null;
  vendor: string | null;
  /** Hex colour without `#`, as stored by Spoolman. */
  colorHex: string | null;
  remainingWeightG: number | null;
}

export type UnloadOutcome = { kind: 'confirmed-success' } | { kind: 'failed'; reason: string } | { kind: 'cancelled' };

export interface SpoolmanService {
  listSpools(printerId: string): Promise<SpoolSummary[]>;
  getActiveSpool(printerId: string): Promise<SpoolSummary | null>;
  setActiveSpool(printerId: string, spoolId: number): Promise<void>;
  /** Must only clear when `outcome.kind === 'confirmed-success'`. */
  clearActiveSpoolAfterUnload(printerId: string, outcome: UnloadOutcome): Promise<void>;
}
