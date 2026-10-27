# LAYR native Qt prototype

This is a **comparison candidate** for a Raspberry Pi 4 running Debian 12 (MainsailOS) and a 1024×600 BTT HDMI7. It is a Qt Quick / QML front end with a Python Moonraker client. It does not embed Chromium, WebEngine, or WebKit.

It does **not** replace the Svelte app in the rest of this repository. It does not edit `printer.cfg` or `moonraker.conf`, and it does not start, stop, or disable `layr-web`, `layr-kiosk`, or KlipperScreen.

Spoolman is not implemented here. See [docs/integration.md](docs/integration.md).

## What you can do with it

Home, Files, Controls, and Settings, aimed at 1024×600 and usable at 800×480.

- Printer name (a label on this screen, saved under `~/.config/layr-qt/preferences.json`, never the Linux hostname)
- Ready / printing / paused / offline, with reconnect
- Nozzle, bed, and chamber cards
- File name, progress, remaining time, thumbnail from Moonraker metadata
- Live toolhead speed from `motion_report.live_velocity` (mm/s)
- Live volumetric flow from `live_extruder_velocity` × filament cross-section (mm³/s), including retraction as a negative value
- M220 / M221 factors are labeled as factors on Controls. They are not shown as mm/s or mm³/s

The client is read-only. It will not send G-code, heat, jog, start, pause, cancel, or delete. Controls that would do those things are disabled.

Default Moonraker URL is `http://localhost:7125`, which matches a trusted client on the printer Pi. Override it in Settings or with `--moonraker`. There is no API key in the tree. If you must use one, export `LAYR_QT_API_KEY` for that shell only; it is not written to preferences.

A dropped socket retries with bounded backoff. Temperatures and speeds clear while the connection is down. They are not replaced with sample data. The screenshot command is the only path that shows fixture numbers, and the window says so.

## Checks on a workstation

From `native-qt/`:

```sh
python3 -m unittest discover -s tests -v
./check-deps.sh
```

`check-deps.sh` only prints what is installed.

## One session on the Pi, without switching the panel

SSH in as the printer user. Do not run this as root.

```sh
cd /path/to/LAYR/native-qt
./check-deps.sh
./scripts/launch-session.sh
```

The launch script defaults to Qt's VNC platform at 1024×600 on port 5900. That does not open the HDMI device, so Chromium or KlipperScreen can keep the panel. From your workstation:

```sh
ssh -L 5900:127.0.0.1:5900 pi@<printer>
```

Then point a VNC client at `127.0.0.1:5900`. Ctrl+C in the SSH session stops only this process.

Stop it from another shell if you need to:

```sh
./scripts/rollback-session.sh
```

That kills the recorded layr-qt pid and nothing else. `--purge` also removes `~/layr-qt` and the optional user unit if you installed those. It does not restart KlipperScreen and it does not disable the Chromium kiosk, because it never disabled them.

EGLFS and linuxfb can take the display. The launch script will not use them unless you set `LAYR_QT_ALLOW_KMS=1` yourself. Leave that unset until you have decided the panel is free. See [docs/debian-packages.md](docs/debian-packages.md).

Optional copy into the home directory, still not a service switch:

```sh
./scripts/install-user.sh --yes
```

`--with-user-unit` writes `~/.config/systemd/user/layr-qt.service` and leaves it **disabled**. The unit's platform is VNC.

## Packages

Debian 12 package names, what is tested, and what is not: [docs/debian-packages.md](docs/debian-packages.md).

Example environment file: [layr-qt.env.example](layr-qt.env.example). Copy it to `~/.config/layr-qt/layr-qt.env` if you want a different size or platform. Do not store an API key in it.

## Speed

Startup, RSS, CPU ticks, and Qt's own touch-to-frame marks are written to `~/.local/state/layr-qt/perf.jsonl`. How to compare that with Chromium on the real Pi, and the fact that this repo has **no Pi timings**, is [docs/benchmark.md](docs/benchmark.md).

## Screenshots

If PyQt6 (or PySide6) and the offscreen plugin are installed:

```sh
cd native-qt
python3 -m layr_qt --screenshot docs/screenshots
```

Those images are fixture data (the banner says so), rendered without a printer. They are not evidence about the HDMI7.

## Layout

```
layr_qt/          Moonraker state machine, telemetry, preferences (no Qt import)
qml/              Qt Quick UI
tests/            unittest, no display and no Moonraker process
scripts/          opt-in launch, rollback, user install, PID sampler
check-deps.sh     read-only package probe
```

The Svelte sources under `src/` and `deploy/` are not imported by this prototype.
