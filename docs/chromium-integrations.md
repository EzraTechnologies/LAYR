# Chromium integrations

Optional Spoolman, AFC, and Happy Hare panels for the Svelte UI. Each one is shown only after Moonraker or Klipper reports that the printer actually has it. A printer without that feature keeps the same navigation and the same controls as before.

LAYR does not install these projects, does not edit `printer.cfg` or `moonraker.conf`, and does not restart Klipper or Moonraker.

The milestone branch `milestone/chromium-hdmi7-hardware-tested-20261028` is not part of this work. Two Pi-only fixes are still outside git (Chromium launcher cache-bust query, and the udev rule that ignores phantom `vc4-hdmi` pointing sticks). This change does not include them and does not touch a Pi.

## Spoolman

Reads go through the existing Moonraker session:

| Call | Purpose |
| --- | --- |
| `server.info` | `components` includes `spoolman`, or the panel stays hidden |
| `server.spoolman.status` | Link up or down. A missing method is treated as "not configured" |
| `server.spoolman.get_spool_id` | Active spool id, including "none" |
| `server.spoolman.proxy` | GET `/v1/spool` only, paged, `allow_archived=true` |

`server.spoolman.post_spool_id` is the only write. It is confirmed, locked while a job is printing or paused, and refused when the link is down. Clearing the active spool after unload happens only when Klipper has accepted the unload macro. Cancel, failure, and a lost reply keep the spool.

The proxy allow-list rejects other methods, paths, and queries before they are sent. Spool pictures are not fetched from any host. Colour comes from Spoolman's hex fields.

There is no timer. The catalogue refreshes when the printer becomes ready, when you press Refresh, and when Moonraker sends `notify_spoolman_status_changed` or `notify_active_spool_set`. A dropped connection discards the list so another printer cannot inherit it.

## AFC

AFC is detected from Klipper objects whose names are `AFC` or start with `AFC_`. Printers without those objects never get an AFC item in the nav. LAYR does not install the add-on and does not edit `printer.cfg`.

The subscription asks Moonraker for every field on those objects (`null`), capped at 40, because AFC versions do not share one field list. Missing values stay blank. Status arrives with the normal printer subscription. There is no extra poll.

Buttons are chosen from `printer.gcode.help` after Klipper is ready:

| Command | When it is offered |
| --- | --- |
| `CHANGE_TOOL LANE=` | Help lists `CHANGE_TOOL`, the lane is one AFC reported, and it is not already loaded |
| `TOOL_LOAD LANE=` | Help has no `CHANGE_TOOL` but does have `TOOL_LOAD` |
| `TOOL_UNLOAD` | Help lists `TOOL_UNLOAD`. A lane is added only when it is the loaded lane |
| `AFC_CLEAR_MESSAGE` | Help lists it and AFC is showing a message. This does not move filament |

Lane motion is refused while a job is printing or paused, while axes are not homed, while `error_state` is true, and while `current_state` is anything other than idle. Clearing a message can run during a print, and still asks first. Calibration, `LANE_MOVE`, blade, speed, and `SET_LANE_LOADED` are not offered.

A dropped connection clears the snapshot, so the nav item and the buttons disappear together.

## Hardware check (not run here)

On a machine that already has the tested Chromium build, after you choose to install a newer frontend yourself:

1. Printer with no `[spoolman]` in Moonraker: Home, Files, Move, Heat, Extrude, Fans, Macros, Console, Settings. There is no Spools item. Extrude still says spool tracking is planned.
2. Add Spoolman in Moonraker yourself and restart Moonraker there. Reconnect LAYR. Spools appears. The active spool shows material, colour, and remaining weight or length when Spoolman sent them. Missing numbers say "Weight not reported".
3. Set another spool. The dialog must appear, and Go back must not change the active spool. Confirm, then check Moonraker's active spool id.
4. Start a print. Set, Clear, and Unload on Spools stay disabled.
5. Stop the print. Unload. If the macro fails or you dismiss the dialog, the active spool stays. If Klipper accepts it, the active spool clears.
6. Stop Spoolman or point Moonraker at a dead address. The panel says the link is down and does not keep showing the old weights.
7. Repeat the look of the panel at 1024×600 and 800×480: touch targets, on-screen keyboard for search, no overlap with the nav.

AFC, on a printer you already configured yourself:

1. No `AFC` object in `printer.objects.list`: there is no AFC item. Opening `#/afc` says AFC is not installed and shows no lane buttons.
2. With AFC loaded and idle, homed, and not printing: lanes show the reported tool map, material, filament status, and weight. A missing weight is omitted. A colour name is text, not a fetched image.
3. Change lane. Go back must send nothing. Confirm sends `CHANGE_TOOL LANE=<name>` and nothing else.
4. Start a print. Change and Unload stay disabled. If AFC has a message and `AFC_CLEAR_MESSAGE` exists, that button can still be confirmed.
5. Put AFC into an error or a non-idle `current_state`. Lane buttons stay disabled until it is idle again.
6. Remove `CHANGE_TOOL` and `TOOL_LOAD` from the printer (or use a build that does not register them). Those buttons are absent. Do not expect a substitute command.
7. Disconnect Moonraker. The AFC item leaves the nav and the lane buttons go away.
8. Check 1024×600 and 800×480: the nav can scroll, targets stay at least 44 px, and lane text that does not fit has a tooltip.

Happy Hare checks are added with that panel.
