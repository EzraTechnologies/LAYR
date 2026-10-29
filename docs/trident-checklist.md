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
- [ ] Spoolman is not on this screen. Choosing or clearing a spool is a later milestone.
- [ ] AFC, if this printer has the add-on: the rail shows AFC only when Klipper lists an `AFC` object. Units, lanes, the loaded lane, and any AFC error match Mainsail or Fluidd. Load, change, unload, hub load, and eject each ask first, and cancelling sends nothing. During a print those buttons stay off. A printer without AFC has no AFC item and `#/afc` says it is not installed. This build has not been checked on a machine with AFC. Do not use it to move filament until the states above match the printer.

## Files and a short print

- [ ] The file list matches Moonraker, including a folder. Sort by name and modified time.
- [ ] Files opens in the compact list. List / Folders on that screen and Settings → Files switch immediately and still match after a reload. Folders shows the real subfolders as cards, then the G-code in that folder, with Back and the path. An empty folder says it is empty. Sorting, print, and delete are unchanged, and the choice does not create or move files.
- [ ] A file with a thumbnail shows it, including a file in a subfolder. A file without one shows the placeholder icon.
- [ ] Start asks for confirmation, then the dashboard shows filename, the G-code thumbnail (including a file in a subfolder; a placeholder when there is none), progress, layer (when the slicer reports it), fans, and time remaining.
- [ ] While printing, Speed is Klipper's live mm/s (`motion_report.live_velocity`) and Flow is live mm³/s from extruder velocity × the configured filament diameter. They are not the M220/M221 percentages. Pause or a stopped extruder shows about 0, not the last percentage. A retract shows a negative flow. Tapping Speed or Flow adjusts the percentage behind that readout. Z offset is still the Z button, which opens Move. There is no Fine Tuning page.
- [ ] Pause, resume, and cancel work. Cancel asks for confirmation and cannot be tapped twice into a second request.
- [ ] Emergency stop needs a press-and-hold, heaters turn off, and the printer shows the Klipper error until firmware restart (which itself asks for confirmation).

## Macros and console

- [ ] The macro list matches `printer.objects.list` and hides names starting with `_` unless "show internal" is on.
- [ ] A macro with a required parameter is not sent from the macro grid; it opens the console so the value can be typed.
- [ ] Every console command asks before it is sent. A multi-line paste is refused. `M112` goes through emergency stop rather than the G-code queue.
- [ ] Responses from the printer appear in the log. After a reconnect the log refills from `server.gcode_store`.

## Display and rollback

- [ ] Settings can set a display name such as "Voron Trident". The top bar uses it. The Linux hostname (often `mainsailos`) is unchanged. Clearing the name shows the Klipper host name again.
- [ ] At the panel's real resolution, no control is cut off and every button is easy to hit. Turn on the black theme and cursor hiding in Settings if this Pi is a kiosk. After Hide pointer, restart only `layr-kiosk` (`sudo systemctl restart layr-kiosk`) and confirm the arrow is gone, touch still works, and a real mouse still clicks. With Hide pointer off, the mouse cursor is visible. Do not restart Klipper for this check.
- [ ] Dim-after-idle blanks the screen and a tap wakes it. There is no animated screensaver.
- [ ] Only after the checks above: `./deploy/layr-display.sh to-layr`. The LAYR kiosk owns the display and KlipperScreen is stopped but still installed.
- [ ] `./deploy/layr-display.sh to-klipperscreen` brings KlipperScreen back.
- [ ] Optional, and only after the browser checks: follow [docs/pi-test.md](pi-test.md) for the WPE experiment. `./deploy/layr-engine.sh check` must be honest about missing packages. `rollback` returns the saved engine to Chromium. None of these commands restart Klipper.
- [ ] `./deploy/rollback.sh` returns the previous UI build. `./deploy/uninstall.sh` removes the LAYR units and, if LAYR had disabled KlipperScreen, turns KlipperScreen back on. `printer.cfg` and `moonraker.conf` are unchanged.
