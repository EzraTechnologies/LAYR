# LAYR native Qt prototype

A touch-first Qt Quick / QML shell for a 1024×600 BTT HDMI7, with an 800×480 layout when the window is smaller. It talks to Moonraker over a WebSocket and HTTP. It does not embed Chromium, WebEngine, or WebKit.

This is a comparison candidate. The Svelte app in the repository root is still the UI. Nothing here installs a service, stops `layr-web`, `layr-kiosk`, or KlipperScreen, or edits `printer.cfg` or `moonraker.conf`.

The prototype is read-only. It cannot jog, heat, extrude, pause, cancel, start a print, or run a macro. Those controls stay unwired until someone reviews them.

## What the home screen shows

- Printer name. An empty name uses the Klipper host name from Moonraker. It never reads the Linux hostname, and saving a name does not change it.
- Ready, printing, paused, connecting, offline, or error.
- Nozzle, bed, and chamber temperatures when Klipper reports them.
- File name, progress, elapsed time, remaining time, layer, and filament used.
- The active file's thumbnail from `server.files.metadata`, fetched only from `/server/files/gcodes/…` after the path is normalised. `..`, other hosts, and non-image bodies are dropped.
- Live movement speed in mm/s from `motion_report.live_velocity`.
- Live volumetric flow in mm³/s: `live_extruder_velocity` times the filament cross-section from `filament_diameter` on the active extruder. Negative flow is retraction. A missing or absurd diameter leaves flow blank. It does not assume 1.75 mm.
- M220 / M221 factors are on Controls, labelled as factors and percents. They are not the speed or flow on Home.

Disconnected and "Klipper not ready" clear those live values. The UI does not keep the last temperatures on screen and does not substitute sample data. Sample data appears only with `--fixture`, which never opens a socket.

## Pages

Home, Files, Controls, Settings. Files can open folders and show metadata. Controls shows homed axes, position, and the override factors. Settings stores the Moonraker URL, the printer name, theme, pointer visibility, and dim timeout.

The pointer is hidden by default so a touch kiosk does not show an arrow. Touch still clicks. A physical mouse still clicks. Settings can show the pointer again. That blank cursor is Qt's override cursor; it has not been checked on the HDMI7, where the touchscreen may also be a pointer device.

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

A key, if you truly need one, is `LAYR_QT_API_KEY` in the environment. It is sent as `X-Api-Key` for a oneshot token and is not written to preferences.

`launch-session.sh` refuses fullscreen when `layr-kiosk` or KlipperScreen is active, and it refuses EGLFS unless you set `LAYR_QT_ALLOW_EGLFS=1`. See [docs/platform.md](docs/platform.md). Prefer a window on the session you already have.

### If you already switched the panel yourself

This prototype will not switch it back. The existing LAYR commands, run by you from the repo, are:

```bash
./deploy/layr-display.sh status
./deploy/layr-display.sh to-layr          # Chromium kiosk, only if you want that
./deploy/layr-display.sh to-klipperscreen # KlipperScreen, only if you want that
```

To restart a kiosk you had already enabled, without disabling it:

```bash
systemctl status layr-kiosk.service
systemctl status KlipperScreen.service
```

Do not remove those units to try Qt.

## Opt-in install and rollback

```bash
./native-qt/scripts/install.sh --dry-run --yes
./native-qt/scripts/install.sh --yes
~/layr-native-qt/current/scripts/launch-session.sh --geometry 1024x600
~/layr-native-qt/current/scripts/rollback.sh --yes
```

Install copies files into `~/layr-native-qt/releases/` and points `current` at the new copy. Rollback points `current` at the previous copy, or removes the link if there was none. Neither command talks to systemd.

## Tests

```bash
cd native-qt
./scripts/verify.sh
```

`verify.sh` runs the unit tests and, when PyQt6 imports, an offscreen QML load. Fixture screenshots:

```bash
./scripts/grab-screenshots.sh
```

Those PNGs are rendered on a PC with the offscreen plugin. They are not the panel.

## Docs

- [docs/platform.md](docs/platform.md) — Bookworm packages, Wayland, xcb, EGLFS, tested versus not tested
- [docs/benchmark.md](docs/benchmark.md) — repeatable Pi comparison against Chromium
- [docs/integrations.md](docs/integrations.md) — how Spoolman and an MMU would share this adapter later

Preferences example: [config.example.json](config.example.json). Copy it to `~/.config/layr-native-qt/preferences.json` or pass `--config`. The API key is intentionally not a field.
