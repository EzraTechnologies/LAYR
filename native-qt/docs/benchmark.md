# On-hardware A/B benchmark

There are **no Raspberry Pi measurements in this repository**. Do not describe the Qt UI as faster, smoother, or lighter than Chromium until the table at the bottom is filled in on the Pi 4 that actually drives the BTT HDMI7.

The agent runs unit tests and, when PyQt6 (Debian 12) or PySide6 and the offscreen plugin are installed, offscreen screenshots of fixture data. Those screenshots do not include GPU scanout, the touchscreen controller, or Chromium.

## Rules

- Do not stop `layr-kiosk`, `layr-web`, Klipper, Moonraker, or KlipperScreen as part of the Qt install.
- Do not pass `LAYR_QT_ALLOW_KMS=1` for the first pass. VNC does not measure panel latency. Say so in the notes.
- Sample whatever PID is already on screen for Chromium. Starting or restarting it is a separate decision and is not required to collect a Qt VNC sample.
- Run `deploy/check-device.sh` from the main app if you want the Pi model and the connector mode. That script only reads.

## Qt marks (inside the process)

`~/.local/state/layr-qt/perf.jsonl` gets one JSON object per line:

- `process_start`, `qt_app_created`, `qml_loaded`, `first_frame`
- `moonraker_connected` after the socket is up and Klipper has sent a snapshot
- `touch_down` / `touch_frame` with `latencyMs` when a control is pressed and the next Qt frame is swapped
- `summary` on exit: startup deltas, median touch-to-frame, RSS, CPU ticks

Touch-to-frame here is **inside Qt**, from the press handler to `frameSwapped`. It is not the time until the HDMI panel changes. Chromium does not emit the same event. Compare panel latency with a camera or an external timestamp, not by subtracting these numbers from a guess.

## Sampling a PID

```sh
# Qt VNC session, in one SSH session:
./native-qt/scripts/launch-session.sh
# In another:
pid=$(cat ~/.local/state/layr-qt/session.pid)
./native-qt/scripts/sample-process.sh "$pid" 60 > /tmp/layr-qt-sample.csv
```

Repeat for the Chromium PID you already have (`pgrep -a chromium` or the kiosk's child). Five runs each, idle on the home screen, then five while Moonraker is streaming a print. Record:

| Run | UI | Platform | Startup to first pixels (ms) | RSS idle (KiB) | RSS printing (KiB) | CPU ticks / 60s | Touch-to-visible (ms) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | Chromium | cage | | | | | external only | |
| | Qt | vnc | from perf.jsonl `startupToFirstFrameMs` | | | | internal only, not the panel | not a winner/loser |
| | Qt | eglfs | only after you choose to free DRM yourself | | | | still needs an external check | |

VNC uses Qt's software raster path. A lower VNC CPU number would not mean EGLFS on the HDMI7 is faster, and a higher one would not mean it is slower.

## Restoring the current screen

`scripts/rollback-session.sh` kills only the pid recorded for layr-qt. It does not start or stop the Chromium kiosk. If you never set `LAYR_QT_ALLOW_KMS=1`, the panel was never handed to Qt.

Leave this table empty until those runs exist. An empty table is the current result.
