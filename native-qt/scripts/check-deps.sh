#!/usr/bin/env bash
# Read-only dependency probe for the native Qt prototype.
# It does not install packages, edit config, or talk to systemd.
set -euo pipefail

python3 - <<'PY'
import glob
import importlib.util
import sys

print("LAYR Qt dependency probe (read only)")
print(f"Python {sys.version.split()[0]}")

modules = [
    "PyQt6.QtCore",
    "PyQt6.QtGui",
    "PyQt6.QtQml",
    "PyQt6.QtQuick",
    "PyQt6.QtNetwork",
    "PyQt6.QtWebSockets",
]
missing = []
for name in modules:
    if importlib.util.find_spec(name) is None:
        missing.append(name)
        print(f"  missing  {name}")
    else:
        print(f"  found    {name}")

if importlib.util.find_spec("PyQt6.QtWebEngine") or importlib.util.find_spec("PyQt6.QtWebEngineQuick"):
    print("  note     Qt WebEngine is installed. This prototype does not import it.")

plugins = sorted(glob.glob("/usr/lib/*/qt6/plugins/platforms/*.so"))
integrations = sorted(glob.glob("/usr/lib/*/qt6/plugins/egldeviceintegrations/*.so"))
qml_marks = {
    "QtQuick": glob.glob("/usr/lib/*/qt6/qml/QtQuick/qmldir"),
    "QtQuick/Controls": glob.glob("/usr/lib/*/qt6/qml/QtQuick/Controls/qmldir"),
    "QtQuick/Layouts": glob.glob("/usr/lib/*/qt6/qml/QtQuick/Layouts/qmldir"),
    "QtQuick/Templates": glob.glob("/usr/lib/*/qt6/qml/QtQuick/Templates/qmldir"),
    "QtQuick/Window": glob.glob("/usr/lib/*/qt6/qml/QtQuick/Window/qmldir"),
    "QtQml": glob.glob("/usr/lib/*/qt6/qml/QtQml/qmldir"),
}
print("QML modules:")
qml_missing = []
for name, paths in qml_marks.items():
    if paths:
        print(f"  found    {name}")
    else:
        qml_missing.append(name)
        print(f"  missing  {name}")

print("Platform plugins:")
wanted = {
    "xcb": "libqxcb.so",
    "offscreen": "libqoffscreen.so",
    "wayland-egl": "libqwayland-egl.so",
    "wayland-generic": "libqwayland-generic.so",
    "eglfs": "libqeglfs.so",
    "linuxfb": "libqlinuxfb.so",
}
found_names = {path.rsplit("/", 1)[-1] for path in plugins}
for label, filename in wanted.items():
    state = "present" if filename in found_names else "absent"
    print(f"  {state:8} {label} ({filename})")
if integrations:
    print("EGLFS device integrations present:")
    for path in integrations:
        print(f"  {path.rsplit('/', 1)[-1]}")
else:
    print("EGLFS device integrations: none found")

print()
print("Package names used on Debian 12 and Ubuntu 24.04 (install them yourself):")
print("  python3-pyqt6 python3-pyqt6.qtquick python3-pyqt6.qtqml python3-pyqt6.qtwebsockets")
print("  qml6-module-qtquick qml6-module-qtquick-controls qml6-module-qtquick-layouts")
print("  qml6-module-qtquick-templates qml6-module-qtquick-window qml6-module-qtqml")
print("  qml6-module-qtqml-workerscript qt6-wayland libqt6gui6 libqt6opengl6")
print("PySide6 is not in Debian 12. Do not use Qt WebEngine for this prototype.")
print("Presence of libqeglfs.so is not a test of the Pi 4 HDMI panel.")
print("This script did not change the system.")

sys.exit(1 if missing or qml_missing else 0)
PY
