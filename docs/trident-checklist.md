# Trident smoke-test checklist

Use this on the Voron Trident after LAYR is installed with `deploy/install.sh` and opened in a normal
browser. Nothing in this repository has been run on that printer. Do not switch off KlipperScreen until
the browser checks below pass.

Moonraker on the Pi should trust `127.0.0.1` (`trusted_clients`). If the page origin is not the Moonraker
origin, add it to `cors_domains` yourself. LAYR does not edit `moonraker.conf`.

## Before touching the machine

- [ ] `./deploy/check-device.sh` prints the Pi model and the connected display's preferred mode. Do not assume 1024×600 or 800×480 if the mode differs; the kiosk uses whatever the connector prefers.
- [ ] KlipperScreen is still enabled. `./deploy/layr-display.sh status` shows it unchanged.
- [ ] `http://127.0.0.1:7180/?moonraker=http://localhost:7125#/home` loads in Chromium on the Pi.
- [ ] With no URL configured (a fresh profile), Home says the printer is not set up and no temperatures or positions appear.
- [ ] A wrong port shows Offline, the attempt counter increases, and controls stay disabled. Fixing the URL reconnects without reloading sample data.

## Motion and heat (bed clear, motors safe to move)

- [ ] Home X, Home Y, Home Z, and Home all. Homing Z alone is refused until X and Y are homed.
- [ ] Jog X/Y/Z at 1 mm and 10 mm. A move that would pass the axis limit is shortened or refused, and the position matches Mainsail or Fluidd.
- [ ] Jogging an axis that is not homed is refused. Jog buttons do nothing while a print is running.
- [ ] Motors off requires confirmation, and the axes show as not homed afterwards.
- [ ] Nozzle and bed targets apply, presets match the printer's limits, and a target outside `min_temp`/`max_temp` is refused. A high target asks for confirmation.
- [ ] Cool-down sets both heaters to 0. Chamber temperature is shown only when that sensor exists.
- [ ] Part-cooling fan and any controllable fans move only when the slider is released. A heater fan that Klipper controls itself has no slider.
- [ ] Lights, if the printer defines them, dim or toggle. If none are configured, the screen says so.

## Filament (hotend at extrusion temperature, no print running)

- [ ] Extrude and retract of a short length work, and the speed is capped.
- [ ] Below `min_extrude_temp` both buttons are refused and no G-code is sent.
- [ ] LOAD / UNLOAD appear only when those macros exist. The toast says the macro finished only after Klipper replies. A failed or cancelled run does not say the filament was unloaded.
- [ ] With no `[spoolman]` section, Extrude still says spool tracking is planned for a later release, and printing, jogging, and heating behave as before.
- [ ] Optional, and only if you already run Spoolman: turn Spoolman on under Settings for this printer. It is off by default, and a second printer address does not inherit it. Add the server in Moonraker's own configuration and restart Moonraker yourself. LAYR must not have edited `moonraker.conf`. On Extrude, confirm the active spool's material, colour, and remaining weight or length. Set a different spool only while the printer is idle, and only after the confirmation. Home and the file detail should name that same spool. Run Unload only if you mean to move filament. The active spool clears only after Klipper accepts that macro. Cancel the dialog, or fail the macro, and the previous spool stays. If Moonraker cannot reach Spoolman, the screen says so and does not show a weight.

## Files and a short print

- [ ] The file list matches Moonraker, including a folder. Sort by name and modified time.
- [ ] Files opens in the compact list. List / Thumbnails on that screen and Settings → Files switch immediately and still match after a reload. Thumbnails shows the real subfolders as cards, then the G-code in that folder, with Back and the path. An empty folder says it is empty. Sorting, print, and delete are unchanged, and the choice does not create or move files. A device that already saved `folders` still opens on Thumbnails.
- [ ] A file with a thumbnail shows it, including a file in a subfolder. A file without one shows the placeholder icon.
- [ ] Start asks for confirmation, then the dashboard shows filename, the G-code thumbnail (including a file in a subfolder; a placeholder when there is none), progress, layer (when the slicer reports it), fans, and time remaining.
- [ ] While printing, Speed is Klipper's live mm/s (`motion_report.live_velocity`) and Flow is live mm³/s from extruder velocity × the configured filament diameter. They are not the M220/M221 percentages. Pause or a stopped extruder shows about 0, not the last percentage. A retract shows a negative flow. Tapping Speed or Flow adjusts the percentage behind that readout. Z offset is still the Z button, which opens Move. There is no Fine Tuning page.
- [ ] Pause, resume, and cancel work. Cancel asks for confirmation and cannot be tapped twice into a second request.
- [ ] Emergency stop needs a press-and-hold, heaters turn off, and the printer shows the Klipper error until firmware restart (which itself asks for confirmation).
- [ ] If this printer has no Happy Hare MMU, or Settings → Happy Hare is off, the rail has no MMU item and `#/mmu` says no `mmu` object was listed. Nothing in that check moves filament.

## Happy Hare (only when this printer already runs it)

Skip this section when Settings → Happy Hare is off or Klipper does not list an `mmu` object. The switch defaults off, is stored per printer, and turning it on turns AFC off. Both can stay off. LAYR does not install Happy Hare and does not edit `printer.cfg` or `mmu.cfg`. These checks have not been done on hardware in this repo. Confirm them on a machine where a wrong tool change is safe (no print, bed clear).

- [ ] With Happy Hare switched on and connected, the rail shows MMU and Home shows the reported tool, gate, and filament. Those match `MMU_STATUS` / Mainsail. Missing fields say they were not reported. Turning the switch off leaves the MMU screen and does not send motion.
- [ ] Load, unload, and tool change are absent when `MMU_LOAD`, `MMU_UNLOAD`, or `MMU_CHANGE_TOOL` is not in `printer.gcode.help`.
- [ ] Confirming Load sends only `MMU_LOAD`. Cancelling sends nothing. The same for Unload and `MMU_CHANGE_TOOL TOOL=n`.
- [ ] While a print is running, those buttons stay disabled and no MMU G-code is sent.
- [ ] With the MMU paused on a real error, the pause reason matches Happy Hare. Recover, if shown, sends only `MMU_RECOVER` after confirmation.
- [ ] A printer without the `mmu` object never shows this screen's data and never calls `printer.gcode.help`.

## Macros and console

- [ ] The macro list matches `printer.objects.list` and hides names starting with `_` unless "show internal" is on.
- [ ] A macro with a required parameter is not sent from the macro grid; it opens the console so the value can be typed.
- [ ] Every console command asks before it is sent. A multi-line paste is refused. `M112` goes through emergency stop rather than the G-code queue.
- [ ] Responses from the printer appear in the log. After a reconnect the log refills from `server.gcode_store`.

## Display and rollback

- [ ] Settings can set a display name such as "Voron Trident". The top bar uses it. The Linux hostname (often `mainsailos`) is unchanged. Clearing the name shows the Klipper host name again.
- [ ] At the panel's real resolution, no control is cut off and every button is easy to hit. Turn on the black theme and cursor hiding in Settings if this Pi is a kiosk. After Hide pointer, restart only `layr-kiosk` (`sudo systemctl restart layr-kiosk`) and confirm the arrow is gone, touch still works, and a real mouse still clicks. With Hide pointer off, the mouse cursor is visible. If a ghost pointer remains on a Pi HDMI input, follow section 8 of [pi-test.md](pi-test.md). That opt-in ignores only `vc4-hdmi` pointing sticks. Do not disable the touchscreen. Do not restart Klipper for this check.
- [ ] After a second install, the kiosk journal shows `layr_build` equal to the new `~/layr/releases/<timestamp>` name, and the page script matches that release. `./deploy/rollback.sh` then a kiosk restart returns the previous value. See [pi-test.md](pi-test.md). `install.sh` does not restart an already running kiosk unless `--reload-kiosk` is passed.
- [ ] Dim-after-idle blanks the screen and a tap wakes it. There is no animated screensaver.
- [ ] AFC, if this printer has the add-on: turn AFC on under Settings for this printer. It is off by default, stored per printer, and turning it on turns Happy Hare off. Both can stay off. The rail shows AFC only when that switch is on and Klipper lists an `AFC` object. Units, lanes, the loaded lane, and any AFC error match Mainsail or Fluidd. Load, change, unload, hub load, and eject each ask first, and cancelling sends nothing. During a print those buttons stay off. A printer without AFC, or with the switch off, has no AFC item and `#/afc` says it is not installed. This build has not been checked on a machine with AFC. Do not use it to move filament until the states above match the printer.
- [ ] Only after the checks above: `./deploy/layr-display.sh to-layr`. The LAYR kiosk owns the display and KlipperScreen is stopped but still installed.
- [ ] `./deploy/layr-display.sh to-klipperscreen` brings KlipperScreen back.
- [ ] Optional, and only after the browser checks: follow [docs/pi-test.md](pi-test.md) for the WPE experiment. `./deploy/layr-engine.sh check` must be honest about missing packages. `rollback` returns the saved engine to Chromium. None of these commands restart Klipper.
- [ ] `./deploy/rollback.sh` returns the previous UI build. `./deploy/uninstall.sh` removes the LAYR units and, if LAYR had disabled KlipperScreen, turns KlipperScreen back on. `printer.cfg` and `moonraker.conf` are unchanged.
