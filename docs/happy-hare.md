# Happy Hare on the Chromium UI

Optional. The MMU item is added to the rail only while Settings → Happy Hare is on for this printer, Klipper is ready, and `printer.objects.list` contains an object named `mmu`. The switch defaults off and is stored per printer. Turning it on turns AFC off. Both can stay off. Turning the switch off leaves the MMU screen and drops the `mmu` subscription. Toggling does not send motion. Printers without that object keep the previous rail, and LAYR does not call `printer.gcode.help` for them. AFC objects are not read and are not controlled.

LAYR does not install Happy Hare, does not edit `printer.cfg`, `mmu.cfg`, or `moonraker.conf`, and does not restart Klipper or Moonraker. The native Qt UI is unchanged. Happy Hare and AFC are mutually exclusive in one printer profile: turning one on turns the other off. Test them one at a time, or on different printers. The Pi installer in [INSTALL-FOR-TESTERS.md](../INSTALL-FOR-TESTERS.md) does not install either controller.

## What the screen shows

Values come from the `mmu` status fields listed in `MMU_FIELDS` (`src/lib/moonraker/objects.ts`). A key this Happy Hare build does not publish arrives as null and is shown as "not reported". The screen does not fill that in from another printer or from a sample.

- Selected tool and gate, including documented `-1` (unknown) and `-2` (bypass)
- Filament word (`Loaded`, `Unloaded`, `Unknown`) and the `filament_pos` name when that integer is in the documented `-1`..`10` range
- Per-gate status (`-1` unknown, `0` empty, `1` available, `2` from buffer), material, name, color, temperature, and spool id when those arrays are present
- `reason_for_pause`, `print_state`, homed, enabled, and the current `action`
- A Home row with the same summary, linking to the MMU screen

`filament_position` is used as the position code only when it is an integer in that range and `filament_pos` is not. A fractional value is a bowden distance and is not shown as a state.

## What it can send

Only after `printer.gcode.help` lists the command, and only after the existing confirmation dialog:

| Button | Script |
| --- | --- |
| Load | `MMU_LOAD` |
| Unload | `MMU_UNLOAD` |
| Change to tool n | `MMU_CHANGE_TOOL TOOL=n` |
| Recover | `MMU_RECOVER` |

Recover is offered when the status reports an unknown filament position, a pause reason, `pause_locked`, `error`, or action `Unknown`. It is sent with no parameters.

Nothing else is sent. There is no servo jog, calibration, `MMU_RESET`, gate-map edit, or `Tx` macro. Load and unload act on the gate Happy Hare already has selected. Tapping a gate only changes which details are on screen.

Moves are refused while `print_stats` is `printing` or Happy Hare `print_state` is `printing` or `started`, while `enabled` is false, and while `action` is one of the documented in-progress strings (`Loading`, `Unloading`, and the other non-idle action names). A paused print can still run a move, and the dialog says the print is paused. Cancelling the dialog sends nothing. A second tap is ignored while the `mmu` command group is in flight.

If the help query fails, the status still shows and every move button stays off.

## What was verified here

Unit tests cover a missing `mmu` object, an AFC name that must not be subscribed, a current status payload, an older payload with no gate arrays, garbage fields, bypass, a paused recover, printing locks, and shutdown/offline clearing the panel. Playwright covers absent, offline, Klipper shutdown, help failure, a missing gate list, printing with the buttons disabled, and a tool change that is sent only after confirmation. Layout is checked at 1024×600 and 800×480. Screenshots for those two sizes are in `docs/screenshots/` (`mmu`, `mmu-error`, `mmu-printing`, `mmu-absent`, `mmu-offline`).

All of that uses a mocked Moonraker. No Raspberry Pi, HDMI panel, or Happy Hare unit was connected.

## What still needs hardware

- The rail and the MMU screen at the panel's real mode, with a finger, including a full gate row
- `MMU_STATUS` matching the tool, gate, filament, colors, and pause reason
- A confirmed `MMU_LOAD`, `MMU_UNLOAD`, and `MMU_CHANGE_TOOL` on a printer where that motion is safe, and a cancel that does not move
- Buttons staying disabled for a whole real print
- Recover against a real `pause_locked` error
- An older Happy Hare build whose status keys differ from the current `get_status`
- A machine with no MMU, confirming the rail is unchanged and Moonraker shows no `printer.gcode.help` from LAYR
