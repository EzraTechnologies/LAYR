# LAYR native Qt controller

A touch-first Qt Quick / QML controller for a 1024×600 BTT HDMI7, with an 800×480 layout when the window is smaller. It talks to Moonraker over a WebSocket and HTTP. It does not embed Chromium, WebEngine, or WebKit.

The Svelte app in the repository root remains the UI behind the Chromium kiosk. Copying these files does not enable a service, does not stop `layr-web`, `layr-kiosk`, KlipperScreen, or a manually created `layr-qt-test.service`, and does not edit `printer.cfg` or `moonraker.conf`.

Commands go through the same safety rules as the Svelte app: latest Klipper state, one action per group, confirmation before dangerous changes, and a success toast only after Moonraker replies. `--fixture` shows sample data and never opens a socket.

## What the home screen shows

- Printer name. An empty name uses the Klipper host name from Moonraker. It never reads the Linux hostname, and saving a name does not change it.
- Ready, printing, paused, connecting, offline, or error.
- Nozzle, bed, and chamber temperatures when Klipper reports them.
- File name, progress, elapsed time, remaining time, layer, and filament used.
- The active file's thumbnail from `server.files.metadata`, fetched only from `/server/files/gcodes/…` after the path is normalised. `..`, other hosts, and non-image bodies are dropped.
- Live movement speed in mm/s from `motion_report.live_velocity`.
- Live volumetric flow in mm³/s: `live_extruder_velocity` times the filament cross-section from `filament_diameter` on the active extruder. Negative flow is retraction. A missing or absurd diameter leaves flow blank. It does not assume 1.75 mm.
- M220 / M221 factors are on Move, labelled as factors and percents. They are not the speed or flow on Home.

Disconnected and "Klipper not ready" clear those live values. The UI does not keep the last temperatures on screen and does not substitute sample data. Sample data appears only with `--fixture`.

## Pages

Home, Move, Heat, Files, More, Setup. Primary actions are on those screens.

- Move homes axes, jogs inside configured travel, and clamps Z at 0 even when `position_min` is negative. During a print the jog pad is replaced by Z babystep (`SET_GCODE_OFFSET`, at most 0.1 mm per tap, ±2 mm total).
- Heat sets hotend and bed targets inside the Klipper limits from `configfile`. High targets, and any target change during a print, ask first. Off sends target 0. Extrusion stays locked below `min_extrude_temp` and while a job is printing. Load and unload appear only when a matching macro exists on this printer.
- Files lists folders, metadata, and thumbnails. Start and delete ask first. The active job cannot be deleted or started again, and a second file cannot be started while a job is active.
- More lists discovered `gcode_macro` objects, including user macros such as Demon Klipper Essentials. Names are not hard-coded. A macro that needs parameters opens the console instead of running empty. The console sends one confirmed line. Restart and firmware restart ask first. Hold STOP for emergency stop.
- Fans and lights are discovered. `heater_fan` and `controller_fan` stay automatic. Part cooling uses `M106` / `M107`. `fan_generic` uses `SET_FAN_SPEED`. Lights use `SET_PIN` or `SET_LED` for objects whose names look like lights.

Controls stay disabled when the socket is down, Klipper is not ready, or that action's group is still waiting. A second tap does not queue another copy.

## Run one session

From a checkout, as the printer user:

```bash
./native-qt/scripts/check-deps.sh
./native-qt/scripts/launch-session.sh --geometry 1024x600
```

The default Moonraker URL is `http://localhost:7125` (trusted client, no API key in the file). Override it for this session only:

```bash
./native-qt/scripts/launch-session.sh --moonraker http://localhost:7125 --geometry 800x480
```

A key, if Moonraker requires one, is `LAYR_QT_API_KEY` in the environment. It is sent as `X-Api-Key` for a oneshot token and is not written to preferences.

`launch-session.sh` refuses fullscreen when `layr-kiosk` or KlipperScreen is active, and it refuses EGLFS unless you set `LAYR_QT_ALLOW_EGLFS=1`. See [docs/platform.md](docs/platform.md). Prefer a window on the session you already have. That window does not replace the running kiosk.

Fixture, with no printer connection:

```bash
python3 -m layr_qt --fixture printing --geometry 1024x600
```

## Pointer and on-screen keyboard

Qt still sets a blank cursor. Cage draws its own sprite when the HDMI7 touch device is also a pointer, so the Qt cursor is not enough. `scripts/qt-kiosk.sh` writes a transparent Xcursor theme (`layr-blank`) and sets `XCURSOR_THEME` and `WLR_NO_HARDWARE_CURSORS=1` when Hide pointer is on. Touch is not disabled. A physical mouse still clicks. Setup can show the system cursor again.

The Setup, Heat, and console keyboards are 240 px (the Heat setpoint pad is 200 px). Focusing a field scrolls it above the keyboard. Commit `b7b438f` fixed the keyboard height. The scroll behaviour is in this branch. Neither the blank Cage cursor nor the keyboard has been checked on the HDMI7. See [docs/pi-smoke.md](docs/pi-smoke.md).

## Opt-in kiosk

Install the unit disabled. This backs up an existing `layr-qt-test.service` when that file is present, and it does not enable or start anything:

```bash
./native-qt/scripts/kiosk-install.sh --dry-run --yes
./native-qt/scripts/kiosk-install.sh --yes
```

Switch the panel only when you mean to. Each command enables one display and disables the others. Chromium stays installed. Klipper and Moonraker are not restarted.

```bash
./native-qt/scripts/kiosk-switch.sh status
./native-qt/scripts/kiosk-switch.sh to-qt --yes
./native-qt/scripts/kiosk-switch.sh to-chromium --yes
./native-qt/scripts/kiosk-switch.sh to-klipperscreen --yes
./native-qt/scripts/kiosk-switch.sh rollback --yes
```

`to-qt` records which panel was enabled, disables KlipperScreen, `layr-kiosk`, and `layr-qt-test`, then enables `layr-qt`. Rollback enables at most one of those recorded units. The file installer below is separate: it only copies a checkout into `~/layr-native-qt` and does not talk to systemd.

```bash
./native-qt/scripts/install.sh --dry-run --yes
./native-qt/scripts/install.sh --yes
~/layr-native-qt/current/scripts/launch-session.sh --geometry 1024x600
~/layr-native-qt/current/scripts/rollback.sh --yes
```

The existing Chromium commands are unchanged:

```bash
./deploy/layr-display.sh status
./deploy/layr-display.sh to-layr
./deploy/layr-display.sh to-klipperscreen
```

Do not enable `layr-qt` and `layr-kiosk` together. Do not remove units to try Qt.

## Tests

```bash
cd native-qt
./scripts/verify.sh
```

`verify.sh` runs the unit tests and, when PyQt6 imports, an offscreen QML load at 1024×600, 800×480 Setup, 800×480 Heat, and 1024×600 Move. The tests assert the Moonraker method and G-code text, and they assert that disconnected, read-only, and invalid states send nothing.

Fixture screenshots (a PC, offscreen, not the panel):

```bash
./scripts/grab-screenshots.sh
```

## Docs

- [docs/platform.md](docs/platform.md) — Bookworm packages, Wayland, xcb, EGLFS, tested versus not tested
- [docs/pi-smoke.md](docs/pi-smoke.md) — Pi checklist for touch, the service, the pointer, the keyboard, controls, auth, a live print, and rollback
- [docs/benchmark.md](docs/benchmark.md) — repeatable Pi comparison against Chromium
- [docs/integrations.md](docs/integrations.md) — Spoolman and an MMU stay unwired

Preferences example: [config.example.json](config.example.json). Copy it to `~/.config/layr-native-qt/preferences.json` or pass `--config`. The API key is intentionally not a field.
