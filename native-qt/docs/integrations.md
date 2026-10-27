# Spoolman and MMU, later, on the same adapter

This prototype does not implement either feature. Spoolman (issue 5) stays the next product priority. AFC / Happy Hare (issue 4) comes after that. The Svelte app's `src/lib/spoolman/types.ts` is unchanged.

The Qt session may only send the methods in `READ_METHODS` (`layr_qt/moonraker/protocol.py`). That set is status, objects, file listing, and file metadata. It does not include G-code, print control, or Spoolman.

## Spoolman

Moonraker already fronts Spoolman. A later port of `SpoolmanPort` in `layr_qt/moonraker/adapters.py` would use:

| Call | Moonraker method | Sent today |
| --- | --- | --- |
| List spools | `server.spoolman.proxy` GET `/v1/spool` | No |
| Active spool | `server.spoolman.get_spool_id` | No |
| Set or clear active spool | `server.spoolman.post_spool_id` | No |

Reads can be added to the allow-list when a screen exists. Writes stay behind the same confirmed-command rule as the TypeScript contract: clear the active spool only after an unload that Klipper actually accepted. `SpoolmanNotReady.clear_active_spool_after_unload` refuses to proceed on a cancelled or failed unload, and still raises because the write is not implemented.

The request builders (`spoolman_list_request`, `spoolman_set_active_request`) exist so the shape can be tested without a network call.

## AFC / Happy Hare

Do not hard-code a subscription. Happy Hare usually shows up as the Klipper object `mmu`. AFC installs often add objects whose names start with `AFC` or `afc`, plus per-lane objects. The exact list comes from `printer.objects.list` on that printer.

`mmu_object_names()` only classifies that list. `plan_subscription()` does not subscribe to those objects, and the UI has no lane, gate, or tool-change controls. When an MMU screen is justified, it should be another read model behind the same session, with motion commands still refused until they have the same checks as the Svelte command gateway.

Nothing here blocks the Svelte Spoolman work. The two UIs do not share a process.
