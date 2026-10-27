# Spoolman and MMU, later

Spoolman (issue #5) and AFC / Happy Hare (issue #4) are not part of this prototype. The Qt client cannot call their write methods. The subscription planner ignores `mmu`, `mmu_machine`, `AFC`, and `afc` even if Klipper lists them. That is deliberate so this experiment does not block the Spoolman work on the Svelte app.

## Same adapter, two extra steps

The Moonraker state machine already has one allow-list (`layr_qt/extensions.py`). A later change can add read methods without a new socket stack:

| Later feature | Moonraker method or object | Gate |
| --- | --- | --- |
| Browse spools | `server.spoolman.proxy` → Spoolman `GET /v1/spool` | Read. Safe to add beside the file list. |
| Active spool | `server.spoolman.get_spool_id` | Read. |
| Set or clear spool | `server.spoolman.post_spool_id` | Write. The Svelte contract says clear only after a confirmed unload. This prototype has no confirmation gateway, so the method stays rejected. |
| Happy Hare | Klipper object `mmu` (and sometimes `mmu_machine`) | Read-only fields first: tool, gate, filament. Homing and tool-change commands stay out until the same command gate as the Svelte app exists. |
| AFC / BoxTurtle | Objects whose names start with `AFC` or `afc` | Same rule. Discover them from `printer.objects.list`, subscribe to a short field list, do not guess a schema. |

`SpoolmanService` in `extensions.py` matches `src/lib/spoolman/types.ts`: list, get active, set active, and clear only when the unload outcome is `confirmed-success`. Nothing in the QML calls it.

The Svelte app remains the place where Spoolman should land first. This UI can grow a page on the same WebSocket once those methods are allowed and the confirmation rules exist. It does not need a second Moonraker connection.
