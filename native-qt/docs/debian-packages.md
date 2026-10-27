# Debian 12 packages and display backends

This note is what the prototype is built against. It is **not** a report from a Raspberry Pi 4.
`check-deps.sh` is the check that matters on the printer: it only reads the system.

## What was checked here

| Check | Where | Result |
| --- | --- | --- |
| Python unit tests (protocol, telemetry, thumbnails, reconnect) | This agent, CPython 3.12 | Run in CI and locally. No printer, no GPU. |
| Qt Quick process and screenshots | Ubuntu 24.04 agent, only when PyQt6 and the offscreen plugin are installed | Fixture pixels. Not a Pi and not the HDMI panel. |
| Platform plugins present on that Ubuntu image | Same agent, Qt 6.4.2 | `libqoffscreen.so`, `libqvnc.so`, `libqlinuxfb.so`, `libqeglfs.so`, `libqxcb.so`, `libqwayland-egl.so`, `libqwayland-generic.so`, plus KMS EGLFS integrations. The GUI library package there is `libqt6gui6t64`, not Debian's `libqt6gui6`. This is an observation of the agent, not a Pi run. |
| apt install on Raspberry Pi OS / MainsailOS | Not done | Package names below are Debian bookworm names. Confirm with `check-deps.sh`. |
| Wayland, X11, EGLFS, KMS, HDMI7 touch, VNC-on-Pi | Not done | Do not treat any of them as working until the Pi procedure in `benchmark.md` is run. |

Debian 12 ships Qt **6.4.2**. Raspberry Pi OS Bookworm and MainsailOS Bookworm use that archive for `arm64` and `armhf`. The app does not pick an architecture. The probe lists whatever plugins exist under `/usr/lib/*/qt6/plugins/platforms`.

## Packages the UI imports

These names were checked against the Debian package pages for bookworm (and the arm64/armhf pages for `python3-pyqt6.qtquick`). They were not installed by this repository. `check-deps.sh` is what you run on the Pi.

Debian 12 does **not** ship PySide6 (`python3-pyside6.qtquick` is in Debian 13 / trixie). Bookworm does ship PyQt6, which talks to the same Qt Quick runtime. The prototype imports PyQt6 first and PySide6 if that is what a later image has.

- `python3-pyqt6`
- `python3-pyqt6.qtqml`
- `python3-pyqt6.qtquick`
- `qml6-module-qtqml`
- `qml6-module-qtqml-workerscript` (Qt Quick Controls loads it; Ubuntu 24.04's controls package does not depend on it hard enough to pull it in alone)
- `qml6-module-qtquick`
- `qml6-module-qtquick-window`
- `qml6-module-qtquick-layouts`
- `qml6-module-qtquick-controls`
- `python3-websockets`
- `libqt6gui6` (includes the offscreen plugin used for screenshots, plus xcb; EGLFS and linuxfb are in this package on Debian's Qt build)
- `qt6-qpa-plugins` (bookworm's package ships the **VNC** platform plugin `libqvnc.so` and the evdev touch helper, not EGLFS)

Optional:

- `qt6-wayland` — Wayland QPA (`libqwayland.so`). A normal desktop compositor can show a window. Cage, which the Chromium kiosk uses, is a single fullscreen client and will not host this UI beside Chromium.
- `fonts-inter` — the Svelte UI uses Inter. Without it, Qt falls back to DejaVu Sans.

Not used, and not a dependency: Qt WebEngine, Qt WebView, WebKit, Cog, Chromium.

## Backends

**VNC (default for `scripts/launch-session.sh`).** `QT_QPA_PLATFORM=vnc:size=1024x600:port=5900` draws into a software framebuffer and listens on localhost. It does not open the HDMI device, so it can run while Chromium or KlipperScreen owns the panel. Open it through an SSH tunnel. VNC numbers are not panel latency and are not a fair speed comparison.

**X11 (`xcb`).** Works only if `DISPLAY` points at an X server. Pointing it at the kiosk's X server can cover that UI. This script does not set `DISPLAY`. Untested on MainsailOS.

**Wayland.** Needs `WAYLAND_DISPLAY` and `qt6-wayland`. Untested on MainsailOS. Do not expect it to share the Cage session LAYR already uses for Chromium.

**EGLFS / linuxfb.** Direct KMS/DRM (EGLFS) or the framebuffer (linuxfb). On a Pi 4 with `vc4-kms-v3d`, Debian's EGLFS KMS integration is the usual path, but this repository has not opened the device. EGLFS takes the display: if Cage, X, or KlipperScreen already holds DRM master, Qt fails or the picture goes away. `launch-session.sh` refuses these platforms unless `LAYR_QT_ALLOW_KMS=1`, and even then it does not stop the other UI.

The app hides the pointer with a blank cursor by default. A mouse or the touchscreen can still click. On EGLFS the launch script also sets `QT_QPA_EGLFS_HIDECURSOR=1`. Whether the BTT HDMI7's touch shows up as a libinput device under EGLFS is **untested**. The VNC session is the one that does not need that answer.

## What a Pi session may install, later, by hand

```sh
sudo apt-get install \
  python3-pyqt6 python3-pyqt6.qtqml python3-pyqt6.qtquick \
  qml6-module-qtqml qml6-module-qtqml-workerscript qml6-module-qtquick qml6-module-qtquick-window \
  qml6-module-qtquick-layouts qml6-module-qtquick-controls \
  python3-websockets libqt6gui6 qt6-qpa-plugins
```

That command is documentation. `check-deps.sh` will not run it.
