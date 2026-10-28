# Spoolman on the Qt Filament screen, MMU still later

The native Qt controller has a Filament screen for Moonraker's Spoolman API. AFC / Happy Hare (issue 4) is not started. The Svelte app still does not implement Spoolman; `src/lib/spoolman/types.ts` remains the unused contract for that UI. The Qt screen follows the same rules: confirm before a write, and clear the active spool only after an unload Klipper has accepted.

This has not been tried on a Raspberry Pi or a physical printer. Fixture screenshots and the unit tests do not open a socket.

## What the screen does

Filament is in the main navigation, between Files and More. Home shows a compact line for the active spool when Spoolman has been read, and that line opens Filament.

Each row shows a spool picture when Spoolman put image bytes in the spool JSON, otherwise a drawn spool wound in the filament colour (or colours). The row also shows the name, vendor, material, a colour swatch, remaining weight, and used weight against the spool weight when Spoolman sent those numbers. Missing numbers stay blank as "Weight not reported". The active spool has a cyan border. An unset active spool says "No active spool". An active id that is not in the loaded list stays labelled as that id.

Search covers name, vendor, material, location, lot, and id. Filters cover material, vendor, colour bucket, and status (available, all, active, archived, empty). The list is paged: Moonraker is asked for 100 spools at a time, and the screen shows 40 of the filtered rows. Previous and Next move that window. Hundreds of spools stay in the Python model; the QML list only builds the visible page.

Set active and Clear active ask first. Nothing is written until you confirm and Moonraker answers. A second tap while the dialog is open, or while that command is still in flight, does not send another copy. A print that is printing or paused locks set, clear, and unload on this printer. The printer shown on the screen is the Moonraker URL for this process. Disconnecting, or saving a different URL, drops the catalogue so one printer's spools are not shown as another's. This build is still one printer per process. It does not claim MMU support.

## Moonraker calls

Reads go out on the existing session after the printer snapshot is in. Writes go through the command gateway with `control=True`.

| Call | Method | When |
| --- | --- | --- |
| Link and active id | `server.spoolman.status` | After subscribe, on Filament refresh, and when the link notification says Spoolman came back |
| Active id | `server.spoolman.get_spool_id` | After a successful status, and again after a successful write |
| List | `server.spoolman.proxy` | GET `/v1/spool` with `use_v2_response: true` and query `allow_archived=true&limit=100&offset=N` |
| Set or clear | `server.spoolman.post_spool_id` | Only after confirmation. `spool_id` is an integer, or `null` to clear |

The proxy allow-list is that list query, or GET `/v1/spool/<id>` with no query. Other methods, paths, and query strings are rejected before they are encoded. A missing Spoolman component (method not found) is reported on the Filament screen and does not drop the Moonraker socket. Core printing does not wait on Spoolman.

`notify_active_spool_set` updates the active id for this connection. `notify_spoolman_status_changed` marks the link offline, or asks for a fresh status when it returns. A stale page from an older connection is ignored.

## Unload

Filament lists `gcode_macro` objects that do not require parameters. It does not look for a particular macro name. Heat still has its own load/unload name list and does not clear a spool.

Unload asks you to run the macro and to clear the active spool only if Klipper accepts it. The clear is sent only after that macro's JSON-RPC result is success. A failure, a dismiss, or a timeout keeps the spool and tells you to clear it yourself after you have checked the printer. Cancelling the dialog sends nothing. A macro run from More does not clear the spool.

## Pictures

Moonraker's proxy returns JSON, so the panel cannot download a binary image through it. Released Spoolman has no image GET that this screen calls. A URL in an extra field is ignored, including `http`, `https`, `file`, and scheme-relative values, so the panel does not fetch an arbitrary host.

If `extra.photo`, `extra.image`, `extra.picture`, or `extra.spool_image` already contains a PNG or JPEG (a `data:image/png` or `data:image/jpeg` URL, or base64), and the decoded bytes are at most 256 KB and match that format, the row shows it. Anything else is dropped and the drawn spool is used.

## When Spoolman is off

If Moonraker has no Spoolman component, Filament explains that printing does not need it and that you add the server in Moonraker's own configuration. If Moonraker cannot reach Spoolman, the screen says the link is down and does not invent weights or leave Set active enabled. Buttons that cannot run stay disabled.

LAYR does not edit `moonraker.conf` or restart Moonraker. When you want the feature, add this in Moonraker yourself and restart Moonraker there:

```
[spoolman]
server: http://127.0.0.1:7912
sync_rate: 5
```

Use the URL of the Spoolman you actually run. The API key for Moonraker, when one is required, stays in `LAYR_QT_API_KEY` and is not written into preferences.

## AFC / Happy Hare

`mmu_object_names()` only classifies names from `printer.objects.list`. `plan_subscription()` does not subscribe to `mmu` or AFC objects, and there are no lane, gate, or tool-change controls. Motion commands stay on the existing command gateway.
