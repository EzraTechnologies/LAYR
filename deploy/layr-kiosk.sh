#!/usr/bin/env bash
# Started by layr-kiosk.service inside a logind session on tty7. Waits for the LAYR web server,
# then runs the selected engine full screen in cage. No resolution is forced: cage uses the
# display's preferred mode. Chromium is the default. WPE (Cog) runs only when LAYR_KIOSK_ENGINE=wpe
# and the Bookworm packages are actually present. This script does not restart Klipper.
set -euo pipefail
status=0
trap 'status=$?; printf "LAYR launcher failed at line %s (exit %s). Inspect journalctl -u layr-kiosk -b.\n" "$LINENO" "$status" >&2; exit "$status"' ERR

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=deploy/kiosk-lib.sh
. "$HERE/kiosk-lib.sh"

LAYR_PORT="${LAYR_PORT:-7180}"
LAYR_MOONRAKER_URL="${LAYR_MOONRAKER_URL:-http://localhost:7125}"
LAYR_PROFILE="${LAYR_PROFILE:-$HOME/.config/layr-chromium}"
LAYR_HOME="${LAYR_HOME:-$HOME/layr}"
LAYR_STATE="${LAYR_STATE:-$LAYR_HOME/state}"
# layr_build is the release directory name. Rollback changes that name, so Chromium
# loads the restored bundle instead of the page it already had open.
PAGE=$(kiosk_page_url "$LAYR_PORT" "$LAYR_MOONRAKER_URL" "$LAYR_HOME")
echo "Kiosk page: $PAGE"
printf 'Session: uid=%s groups=%s runtime=%s seat=%s vt=%s session_type=%s\n' "$(id -u)" "$(id -nG)" "${XDG_RUNTIME_DIR:-unset}" "${XDG_SEAT:-unset}" "${XDG_VTNR:-unset}" "${XDG_SESSION_TYPE:-unset}"
echo "Starting a kiosk process does not verify visible rendering or touchscreen input."

command -v cage >/dev/null || { echo "cage is not installed" >&2; exit 1; }

engine=$(resolve_launch_engine)
backend="${LAYR_CHROMIUM_BACKEND-wayland}"
if [ "$engine" = chromium ]; then
  case "$backend" in
    wayland) ;;
    x11)
      command -v Xwayland >/dev/null || {
        echo "LAYR_CHROMIUM_BACKEND=x11 requires XWayland. Run layr backend --chromium-backend x11 to prepare its dependency." >&2
        exit 1
      }
      ;;
    *) echo "LAYR_CHROMIUM_BACKEND must be wayland or x11 (actual: $backend). No fallback was attempted." >&2; exit 1 ;;
  esac
  echo "Chromium backend: $backend (Cage remains the Wayland compositor)."
fi

ready=0
for _ in $(seq 1 30); do
  if curl -fsS --connect-timeout 2 --max-time 3 -o /dev/null "http://localhost:${LAYR_PORT}/"; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "LAYR web server did not answer on port ${LAYR_PORT}" >&2; exit 1; }

mkdir -p "$LAYR_STATE"
printf '%s\n' "$engine" >"$LAYR_STATE/last-engine"

# The BTT HDMI7 exposes touch as a pointer, so Cage draws an arrow even when the page sets
# cursor:none. KlipperScreen hides that sprite with a blank GDK cursor. The equivalent here,
# used only when Hide pointer is on, is a transparent Xcursor theme plus a software cursor.
# The input device is left enabled: touch still works, and a physical mouse still clicks.
# WLR_NO_HARDWARE_CURSORS is set only in that case. It is not verified on the panel itself.
if [ "$(read_hide_cursor)" = "1" ]; then
  python3 "$HERE/blank-cursor.py" "$LAYR_HOME/share/icons"
  export XCURSOR_PATH="$LAYR_HOME/share/icons${XCURSOR_PATH:+:$XCURSOR_PATH}"
  export XCURSOR_THEME=layr-blank
  export XCURSOR_SIZE="${XCURSOR_SIZE:-24}"
  export WLR_NO_HARDWARE_CURSORS=1
  echo "Hide pointer is on: using the layr-blank cursor theme."
else
  echo "Hide pointer is off: leaving the normal cursor theme so a physical mouse stays visible."
fi

if [ "$engine" = "wpe" ]; then
  platform=$(find_cog_wayland_platform)
  # Bookworm Cog is 0.16.1. --platform and --bg-color are in its man page.
  # COG_PLATFORM_WL_VIEW_FULLSCREEN is the wl plugin's documented fullscreen request (Cog 0.16).
  # Cage still owns the output, so a missed fullscreen request does not change the mode.
  if [ "$platform" = "wl" ]; then
    export COG_PLATFORM_WL_VIEW_FULLSCREEN=1
  elif [ "$platform" = "fdo" ]; then
    export COG_PLATFORM_FDO_VIEW_FULLSCREEN=1
  fi
  # Separate from the Chromium profile. localStorage set in one engine is not visible in the other.
  # The Moonraker URL is on the query string, so the connection does not depend on that profile.
  export XDG_CACHE_HOME="${LAYR_WPE_CACHE:-$HOME/.cache/layr-wpe}"
  export XDG_DATA_HOME="${LAYR_WPE_DATA:-$HOME/.local/share/layr-wpe}"
  mkdir -p "$XDG_CACHE_HOME" "$XDG_DATA_HOME"
  echo "Starting Cog (WPE WebKit) platform=${platform}. Chromium remains the saved rollback."
  exec cage -s -d -- cog --platform="$platform" --bg-color='#0a0c11ff' "$PAGE"
fi

browser=$(command -v chromium-browser || command -v chromium || true)
[ -n "$browser" ] || { echo "Chromium is not installed" >&2; exit 1; }

# A dedicated profile keeps LAYR settings (localStorage) separate from any desktop browser profile.
# Mark the last session as clean so Chromium does not show a "restore pages" bubble after a power cut.
mkdir -p "$LAYR_PROFILE/Default"
prefs="$LAYR_PROFILE/Default/Preferences"
if [ -f "$prefs" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$prefs"
fi

echo "Starting Chromium; ozone-platform=$backend; profile=$LAYR_PROFILE"
# -s keeps VT switching (Ctrl+Alt+F1..) available for recovery; -d drops client-side decorations.
chromium_args=("$browser"
  --kiosk \
  --user-data-dir="$LAYR_PROFILE" \
  --ozone-platform="$backend" \
  --touch-events=enabled \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-session-crashed-bubble \
  '--disable-features=TranslateUI,Translate' \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --check-for-update-interval=31536000 \
  --password-store=basic \
  "$PAGE")
if [ "$backend" = x11 ]; then
  # Cage creates its own XWayland DISPLAY. Never reuse an unrelated X server.
  # Some Cage builds omit XWayland support; report that explicitly inside Cage.
  unset DISPLAY
  exec cage -s -d -- bash -c '
    [ -n "${DISPLAY:-}" ] || {
      echo "Cage did not provide an XWayland DISPLAY. Check Cage XWayland build support and its journal; Chromium was not started." >&2
      exit 1
    }
    exec "$@"
  ' layr-chromium "${chromium_args[@]}"
fi
exec cage -s -d -- "${chromium_args[@]}"
