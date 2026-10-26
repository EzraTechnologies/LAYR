#!/usr/bin/env bash
# Started by layr-kiosk.service inside a logind session on tty7. Waits for the LAYR web server, then runs
# Chromium full screen in cage. No resolution is forced: cage uses the display's preferred mode.
set -euo pipefail

LAYR_PORT="${LAYR_PORT:-7180}"
LAYR_MOONRAKER_URL="${LAYR_MOONRAKER_URL:-http://localhost:7125}"
LAYR_PROFILE="${LAYR_PROFILE:-$HOME/.config/layr-chromium}"
PAGE="http://localhost:${LAYR_PORT}/?moonraker=${LAYR_MOONRAKER_URL}#/home"

browser=$(command -v chromium-browser || command -v chromium || true)
[ -n "$browser" ] || { echo "Chromium is not installed" >&2; exit 1; }
command -v cage >/dev/null || { echo "cage is not installed" >&2; exit 1; }

ready=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:${LAYR_PORT}/"; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "LAYR web server did not answer on port ${LAYR_PORT}" >&2; exit 1; }

# A dedicated profile keeps LAYR settings (localStorage) separate from any desktop browser profile.
# Mark the last session as clean so Chromium does not show a "restore pages" bubble after a power cut.
mkdir -p "$LAYR_PROFILE/Default"
prefs="$LAYR_PROFILE/Default/Preferences"
if [ -f "$prefs" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$prefs"
fi

# -s keeps VT switching (Ctrl+Alt+F1..) available for recovery; -d drops client-side decorations.
exec cage -s -d -- "$browser" \
  --kiosk \
  --user-data-dir="$LAYR_PROFILE" \
  --ozone-platform=wayland \
  --touch-events=enabled \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI,Translate \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --check-for-update-interval=31536000 \
  --password-store=basic \
  "$PAGE"
