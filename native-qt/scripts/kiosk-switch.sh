#!/usr/bin/env bash
# Switch the panel between the native Qt kiosk, the Chromium LAYR kiosk, and KlipperScreen.
#
#   ./kiosk-switch.sh status
#   ./kiosk-switch.sh to-qt --yes
#   ./kiosk-switch.sh to-chromium --yes
#   ./kiosk-switch.sh to-klipperscreen --yes
#   ./kiosk-switch.sh rollback --yes
#
# Only one of layr-qt, layr-kiosk (Chromium), and KlipperScreen is enabled.
# layr-qt-test, if present, is disabled when another panel is selected.
# The Chromium unit file is not rewritten. Klipper and Moonraker are not restarted.
# printer.cfg and moonraker.conf are not edited.
set -euo pipefail

ACTION="${1:-status}"
if [ $# -gt 0 ]; then
  shift
fi
ASSUME_YES=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

STATE_DIR="${HOME}/layr-native-qt/state"
STATE_FILE="${STATE_DIR}/display-before-qt"

run_systemctl() {
  local unit="${!#}"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "systemctl $*"
    return 0
  fi
  if [ "$1" = "disable" ] && ! systemctl cat "$unit" >/dev/null 2>&1; then
    echo "skip missing ${unit}"
    return 0
  fi
  sudo systemctl "$@"
}

require_yes() {
  if [ "$ASSUME_YES" -ne 1 ] && [ "$DRY_RUN" -ne 1 ]; then
    echo "Refusing to switch without --yes. Nothing was changed." >&2
    exit 2
  fi
}

disable_others_for_qt() {
  run_systemctl disable --now KlipperScreen.service
  run_systemctl disable --now layr-kiosk.service
  run_systemctl disable --now layr-qt-test.service
  run_systemctl enable --now layr-qt.service
}

case "$ACTION" in
  status)
    echo "Display units (read only):"
    for unit in layr-qt.service layr-qt-test.service layr-kiosk.service KlipperScreen.service; do
      if command -v systemctl >/dev/null 2>&1; then
        enabled=$(systemctl is-enabled "$unit" 2>/dev/null || true)
        active=$(systemctl is-active "$unit" 2>/dev/null || true)
        printf '  %-24s enabled=%s active=%s\n' "$unit" "${enabled:-unknown}" "${active:-unknown}"
      else
        printf '  %-24s systemctl not available\n' "$unit"
      fi
    done
    ;;
  to-qt)
    require_yes
    echo "This disables KlipperScreen, the Chromium kiosk, and layr-qt-test, then enables only layr-qt."
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "record previous display in ${STATE_FILE}"
    else
      mkdir -p "$STATE_DIR"
      {
        echo "switchedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        if command -v systemctl >/dev/null 2>&1; then
          for unit in KlipperScreen.service layr-kiosk.service layr-qt-test.service; do
            echo "${unit}=$(systemctl is-enabled "$unit" 2>/dev/null || echo missing)"
          done
        fi
      } >"$STATE_FILE"
    fi
    disable_others_for_qt
    echo "Only layr-qt.service is the selected panel. Chromium remains installed."
    ;;
  to-chromium)
    require_yes
    echo "This disables the Qt kiosk and KlipperScreen, then enables the existing Chromium layr-kiosk unit."
    run_systemctl disable --now layr-qt.service
    run_systemctl disable --now layr-qt-test.service
    run_systemctl disable --now KlipperScreen.service
    run_systemctl enable --now layr-kiosk.service
    echo "Chromium kiosk selected. The Qt unit was not removed."
    ;;
  to-klipperscreen)
    require_yes
    echo "This disables both LAYR kiosks, then enables KlipperScreen."
    run_systemctl disable --now layr-qt.service
    run_systemctl disable --now layr-qt-test.service
    run_systemctl disable --now layr-kiosk.service
    run_systemctl enable --now KlipperScreen.service
    echo "KlipperScreen selected. LAYR units were not removed."
    ;;
  rollback)
    require_yes
    echo "This disables layr-qt.service."
    run_systemctl disable --now layr-qt.service
    if [ -f "$STATE_FILE" ]; then
      echo "Restoring one recorded panel from ${STATE_FILE}"
      ks=""
      kiosk=""
      manual=""
      while IFS='=' read -r unit value; do
        case "$unit" in
          KlipperScreen.service) ks="$value" ;;
          layr-kiosk.service) kiosk="$value" ;;
          layr-qt-test.service) manual="$value" ;;
        esac
      done <"$STATE_FILE"
      # Never turn two panel units back on together.
      if [ "$ks" = "enabled" ] || [ "$ks" = "enabled-runtime" ]; then
        run_systemctl enable --now KlipperScreen.service
      elif [ "$kiosk" = "enabled" ] || [ "$kiosk" = "enabled-runtime" ]; then
        run_systemctl enable --now layr-kiosk.service
      elif [ "$manual" = "enabled" ] || [ "$manual" = "enabled-runtime" ]; then
        run_systemctl enable --now layr-qt-test.service
      else
        echo "Recorded panels were not enabled. No other unit was enabled."
      fi
    else
      echo "No previous display was recorded. No other unit was enabled."
    fi
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 2
    ;;
esac
