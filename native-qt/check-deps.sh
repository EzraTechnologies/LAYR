#!/bin/sh
# Read-only dependency probe for the native Qt prototype.
# It never installs packages, never restarts services, and never edits printer files.
set -eu

python_ok=0
if command -v python3 >/dev/null 2>&1; then
  if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
    python_ok=1
    echo "ok   python3 $(python3 -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')"
  else
    echo "miss python3 >= 3.11 (found $(python3 --version 2>/dev/null || true))"
  fi
else
  echo "miss python3"
fi

check_import() {
  module=$1
  label=$2
  if python3 -c "import $module" >/dev/null 2>&1; then
    echo "ok   $label"
  else
    echo "miss $label"
  fi
}

if [ "$python_ok" -eq 1 ]; then
  if python3 -c 'import PyQt6.QtQuick' >/dev/null 2>&1; then
    echo "ok   PyQt6.QtQuick (python3-pyqt6 + python3-pyqt6.qtquick) — Debian 12 package"
  elif python3 -c 'import PySide6.QtQuick' >/dev/null 2>&1; then
    echo "ok   PySide6.QtQuick — not in Debian 12; present on this machine anyway"
  else
    echo "miss PyQt6.QtQuick (bookworm: python3-pyqt6 and python3-pyqt6.qtquick)"
    echo "     PySide6 is not in Debian 12. It is in Debian 13 and is also accepted if installed."
  fi
  check_import PyQt6.QtQml "PyQt6.QtQml (python3-pyqt6.qtqml)"
  check_import websockets "websockets (python3-websockets)"
else
  echo "miss Python Qt bindings and websockets skipped until python3 works"
fi

echo
echo "Qt platform plugins found on this machine:"
found=0
for dir in /usr/lib/*/qt6/plugins/platforms /usr/lib/qt6/plugins/platforms; do
  if [ -d "$dir" ]; then
    found=1
    for plugin in "$dir"/*.so; do
      [ -e "$plugin" ] || continue
      echo "     $(basename "$plugin")  ($dir)"
    done
  fi
done
if [ "$found" -eq 0 ]; then
  echo "     none — libqt6gui6 / qt6-qpa-plugins / qt6-wayland are not installed, or the plugin path differs"
fi

echo
echo "QML modules (qml6-module-* packages that dpkg knows about):"
if command -v dpkg-query >/dev/null 2>&1; then
  dpkg-query -W -f '${Package} ${Status}\n' 'qml6-module-*' 2>/dev/null | sed 's/^/     /' || true
  if ! dpkg-query -W -f '${Package}\n' 'qml6-module-qtquick' >/dev/null 2>&1; then
    echo "     qml6-module-qtquick is not installed"
  fi
else
  echo "     dpkg-query is not available; plugin files above are the only check"
fi

echo
echo "This script does not install anything. On Debian 12 / Raspberry Pi OS Bookworm the prototype expects:"
echo "  python3-pyqt6 python3-pyqt6.qtqml python3-pyqt6.qtquick"
echo "  qml6-module-qtqml qml6-module-qtqml-workerscript qml6-module-qtquick qml6-module-qtquick-window qml6-module-qtquick-layouts qml6-module-qtquick-controls"
echo "  python3-websockets libqt6gui6 qt6-qpa-plugins"
echo "PySide6 (python3-pyside6.qtquick) is not in bookworm. Debian 13 has it, and the app will use it if PyQt6 is absent."
echo "Optional: qt6-wayland (windowed Wayland), fonts-inter (closer to the Svelte UI)."
echo "EGLFS and linuxfb are opt-in only. See docs/debian-packages.md. Do not apt-install from this script."
