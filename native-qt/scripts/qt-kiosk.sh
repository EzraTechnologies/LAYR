#!/usr/bin/env bash
# Foreground Cage session for the native Qt controller.
#
# The systemd unit calls this. It does not enable, disable, or stop any service,
# and it does not edit printer.cfg or moonraker.conf.
#
# Cage draws its own pointer when the touchscreen is also a mouse. Qt's blank
# cursor does not remove that sprite. When Hide pointer is on, this script
# installs a transparent Xcursor theme and asks Cage for a software cursor.
# Touch stays enabled. A physical mouse still clicks; the sprite is blank.
# That behaviour is not confirmed on a BTT HDMI7 until someone checks the panel.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
PRINT_ENV=0

while [ $# -gt 0 ]; do
  case "$1" in
    --print-env) PRINT_ENV=1; shift ;;
    -h|--help)
      echo "Usage: qt-kiosk.sh [--print-env]"
      echo "Runs Cage with the Qt controller. Does not change which service is enabled."
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

CONFIG="${LAYR_QT_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/layr-native-qt/preferences.json}"
HIDE=1
if [ -f "$CONFIG" ]; then
  HIDE=$(python3 - "$CONFIG" <<'PY'
import json
import sys
from pathlib import Path
try:
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError):
    data = {}
print("0" if data.get("hideCursor") is False else "1")
PY
)
fi

ICON_ROOT="${LAYR_QT_ICON_ROOT:-${HOME}/layr-native-qt/share/icons}"
if [ "$HIDE" = "1" ]; then
  PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}" python3 -m layr_qt.blank_cursor "$ICON_ROOT"
  export XCURSOR_PATH="${ICON_ROOT}${XCURSOR_PATH:+:${XCURSOR_PATH}}"
  export XCURSOR_THEME=layr-blank
  export XCURSOR_SIZE="${XCURSOR_SIZE:-24}"
  # Software cursor so Cage uses the theme above. This does not remove the input device.
  export WLR_NO_HARDWARE_CURSORS=1
fi

echo "touch=enabled"
echo "mouse=optional"
if [ "$HIDE" = "1" ]; then
  echo "XCURSOR_THEME=${XCURSOR_THEME}"
  echo "WLR_NO_HARDWARE_CURSORS=${WLR_NO_HARDWARE_CURSORS}"
else
  echo "XCURSOR_THEME=system"
fi
echo "cage=-s -d"

if [ "$PRINT_ENV" = "1" ]; then
  exit 0
fi

if ! command -v cage >/dev/null 2>&1; then
  echo "cage is not installed. The Qt controller was not started." >&2
  exit 1
fi

export PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
# -s keeps VT switching (Ctrl+Alt+F1) available. -d skips client decorations.
# No input device is disabled.
exec cage -s -d -- python3 -m layr_qt --fullscreen --platform wayland --config "$CONFIG"
