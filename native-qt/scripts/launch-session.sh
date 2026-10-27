#!/usr/bin/env bash
# Run one foreground native Qt session.
# Does not stop layr-web, layr-kiosk, KlipperScreen, or any other service.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
FULLSCREEN=0
EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    --fullscreen) FULLSCREEN=1; EXTRA+=("--fullscreen"); shift ;;
    --window) FULLSCREEN=0; shift ;;
    --platform)
      EXTRA+=("--platform" "$2")
      case "$2" in
        eglfs|eglfs:*)
          if [ "${LAYR_QT_ALLOW_EGLFS:-}" != "1" ]; then
            echo "Refusing EGLFS/KMS. It can take the HDMI device from the display that is already running." >&2
            echo "It has not been tested on a BTT HDMI7. Leave the platform unset (wayland or xcb)." >&2
            exit 2
          fi
          ;;
      esac
      shift 2
      ;;
    -h|--help)
      echo "Usage: ./scripts/launch-session.sh [--window] [--fullscreen] [--geometry 1024x600] [--cursor is not a flag; use Settings]"
      echo "This command does not stop the current panel."
      exit 0
      ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

case "${QT_QPA_PLATFORM:-}" in
  eglfs|eglfs:*)
    if [ "${LAYR_QT_ALLOW_EGLFS:-}" != "1" ]; then
      echo "Refusing QT_QPA_PLATFORM=eglfs. Unset it, or this process can claim the HDMI device." >&2
      exit 2
    fi
    ;;
esac

service_active() {
  if ! command -v systemctl >/dev/null 2>&1; then
    return 1
  fi
  systemctl is-active --quiet "$1" 2>/dev/null && return 0
  systemctl --user is-active --quiet "$1" 2>/dev/null && return 0
  return 1
}

if [ "$FULLSCREEN" -eq 1 ]; then
  if service_active layr-kiosk.service || service_active KlipperScreen.service; then
    echo "layr-kiosk or KlipperScreen is active. Fullscreen was refused." >&2
    echo "This prototype will not stop either service. Use a window instead:" >&2
    echo "  ./native-qt/scripts/launch-session.sh --geometry 1024x600" >&2
    echo "To see what owns the panel, from the LAYR repo:" >&2
    echo "  ./deploy/layr-display.sh status" >&2
    exit 2
  fi
fi

export PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
echo "Starting one native Qt session from ${ROOT}"
echo "Existing display services are left running."
exec python3 -m layr_qt "${EXTRA[@]}"
