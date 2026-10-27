# Qt on Debian 12 and the Pi 4

This prototype targets packages that Debian 12 (Bookworm) publishes for `arm64` and `armhf`, which is what Raspberry Pi OS and MainsailOS use. It does not vendor Qt and it does not download a pip wheel of PyQt.

## What was chosen

| Choice | Why |
| --- | --- |
| Qt Quick / QML | The UI is a scene graph, not a browser. |
| PyQt6 (`python3-pyqt6`, `python3-pyqt6.qtquick`, `python3-pyqt6.qtwebsockets`) | These packages are in Bookworm for amd64, arm64, and armhf at Qt 6.4.2. |
| Not PySide6 | `python3-pyside6.qtcore` is not in Bookworm. It appears in Debian 13. |
| Not Qt WebEngine, WPE, or WebKit | The point of this prototype is to leave Chromium and WebKit out. |
| Not C++ for the first cut | The same Qt Quick modules would be used, and PyQt6 is already packaged. A C++ shell can replace `layr_qt/qt_host.py` later without changing the Moonraker model. |

`python3-pyqt6` itself contains the Qt Network bindings. There is no separate `python3-pyqt6.qtnetwork` package on Ubuntu 24.04 or in the Bookworm package list this repo checked.

Bookworm package names to install yourself:

```text
python3-pyqt6 python3-pyqt6.qtquick python3-pyqt6.qtqml python3-pyqt6.qtwebsockets
qml6-module-qtquick qml6-module-qtquick-controls qml6-module-qtquick-layouts
qml6-module-qtquick-templates qml6-module-qtquick-window qml6-module-qtqml
qml6-module-qtqml-workerscript qt6-wayland libqt6gui6 libqt6opengl6
fonts-dejavu-core
```

`native-qt/scripts/check-deps.sh` only looks. It does not install.

## Rendering plugins

Qt picks a platform plugin at startup. The probe prints which `.so` files exist under `/usr/lib/*/qt6/plugins/platforms/`. Do not assume a path from this document; the script is the check.

On the agent that produced this branch (Ubuntu 24.04 x86_64, Qt 6.4.2 from apt, not a Pi):

| Plugin | Package that owned it here | Exercised? |
| --- | --- | --- |
| `libqxcb.so` | `libqt6gui6` | No. There was no X11 session. |
| `libqoffscreen.so` | `libqt6gui6` | Yes. Self-check and the fixture screenshots use it with the software scene graph. |
| `libqwayland-egl.so`, `libqwayland-generic.so` | `qt6-wayland` | No. |
| `libqeglfs.so` plus `libqeglfs-kms-integration.so` | `libqt6opengl6` | No. The launcher refuses EGLFS unless `LAYR_QT_ALLOW_EGLFS=1`. |
| `libqlinuxfb.so` | `libqt6gui6` | No. |
| `libqvnc.so` | `qt6-qpa-plugins` | No. Bookworm's `qt6-qpa-plugins` description lists VNC and uioTouch; that package is not where xcb/eglfs live. |

Debian Bookworm's file layout was **not** installed on the agent. Bookworm's published `qt6-qpa-plugins` description only mentions uioTouch and VNC. xcb, offscreen, linuxfb, and eglfs, when Debian builds them, live in the GUI/OpenGL packages. Run `check-deps.sh` on the Pi and trust that output.

### Wayland

Use this when a Wayland compositor is already running and will accept another client (`WAYLAND_DISPLAY` is set). Qt then loads `libqwayland-egl.so` from `qt6-wayland`. That is the right plugin for a desktop session on Raspberry Pi OS Bookworm (labwc or wayfire).

Cage, which the Chromium kiosk uses, is a single-application compositor. A windowed Qt session does not run beside that Cage, and `launch-session.sh` does not stop it. The opt-in `layr-qt.service` starts its own Cage on tty7 with `scripts/qt-kiosk.sh` as the only client. That unit is installed disabled. `kiosk-switch.sh` is what disables the Chromium kiosk or KlipperScreen and enables Qt, and the reverse. See [pi-smoke.md](pi-smoke.md).

### X11 / xcb

KlipperScreen on MainsailOS is commonly an Xorg session. A windowed Qt process can use `xcb` only if it is launched inside that session (`DISPLAY` set). The launcher does not start Xorg.

### EGLFS / KMS

EGLFS draws without a window system. On this Ubuntu image the plugin and the KMS integration (`eglfs_kms`) are installed. That is not evidence it drives a BTT HDMI7. On a Pi 4 the HDMI framebuffer is often already owned by Cage or Xorg. Opening EGLFS can fail, or it can take the DRM device and blank the panel even though no systemd unit was stopped. `launch-session.sh` and `python -m layr_qt --platform eglfs` refuse that unless `LAYR_QT_ALLOW_EGLFS=1`. Leave it unset.

`linuxfb` is untested. It is a dumb framebuffer path and not the intended one for a Pi 4 with a GPU.

## Pointer on Cage

Qt's blank cursor does not remove the sprite Cage draws for the HDMI7 touch device. `scripts/qt-kiosk.sh` generates a 1×1 transparent theme named `layr-blank` and, when Hide pointer is on, exports `XCURSOR_THEME=layr-blank` and `WLR_NO_HARDWARE_CURSORS=1`. Touch is left enabled. A USB mouse still delivers clicks. This is the same idea as `deploy/blank-cursor.py` for the Chromium kiosk. It has not been confirmed on the panel. `qt-kiosk.sh --print-env` prints the variables without starting Cage.

## What was tested

On the agent (Ubuntu, not a Pi), `native-qt/scripts/verify.sh`:

- Python unit tests for telemetry, reconnect, thumbnail URL safety, the command allow-list, and the exact G-code / Moonraker methods for jog, home, babystep, heaters, fans, lights, extrusion, macros, console, print control, file delete, and emergency stop.
- Those tests also cover refusals: disconnected, fixture, not homed, Z below 0, cold extrusion, active-file delete, path traversal, automatic fans, and a second tap while a command is in flight.
- Offscreen QML load (`QT_QPA_PLATFORM=offscreen`, `QT_QUICK_BACKEND=software`) at 1024×600, 800×480 Setup, 800×480 Heat, and 1024×600 Move.
- Dry-run checks that `kiosk-install.sh` does not enable a unit, that it keeps distinct backups of a system and a user `layr-qt-test.service`, and that `kiosk-switch.sh` enables only one panel.

## What was not tested

- Raspberry Pi 4, Debian 12 / MainsailOS, or a BTT HDMI7.
- Touch on that panel.
- Whether the `layr-blank` theme actually hides Cage's arrow. Do not treat the unit tests as that result.
- The on-screen keyboard on 1024×600 or 800×480 hardware, including scroll-into-view while typing.
- Wayland on the Pi, xcb inside KlipperScreen's X server, EGLFS, and linuxfb.
- A real Moonraker on `http://localhost:7125`, including authentication and a live print.
- CPU, RAM, startup, or touch latency versus Chromium. See [benchmark.md](benchmark.md).
- The checklist in [pi-smoke.md](pi-smoke.md).
