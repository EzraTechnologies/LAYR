#!/usr/bin/env bash
# Choose the kiosk renderer. Chromium is the default and the rollback.
#
#   ./deploy/layr-engine.sh status
#   ./deploy/layr-engine.sh check
#   ./deploy/layr-engine.sh use chromium|wpe [--yes] [--restart-kiosk]
#   ./deploy/layr-engine.sh rollback [--yes] [--restart-kiosk]
#
# Nothing here installs packages, edits printer.cfg, or restarts Klipper, Moonraker, or
# KlipperScreen. --restart-kiosk restarts layr-kiosk.service only, and only when you pass it.
# WPE is refused unless `check` would succeed, so a missing Cog install cannot become the saved engine.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=deploy/kiosk-lib.sh
. "$HERE/kiosk-lib.sh"

LAYR_HOME="${LAYR_HOME:-${HOME:-/tmp}/layr}"
LAYR_ENV="${LAYR_ENV:-$LAYR_HOME/layr.env}"
LAYR_STATE="${LAYR_STATE:-$LAYR_HOME/state}"
ASSUME_YES=0
RESTART_KIOSK=0

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

saved_engine() {
  local line
  if [ -f "$LAYR_ENV" ]; then
    line=$(grep -E '^LAYR_KIOSK_ENGINE=' "$LAYR_ENV" | tail -n 1 || true)
    if [ -n "$line" ]; then
      printf '%s\n' "${line#LAYR_KIOSK_ENGINE=}"
      return 0
    fi
  fi
  printf 'chromium\n'
}

write_engine() {
  local engine="$1" tmp
  mkdir -p "$(dirname "$LAYR_ENV")" "$LAYR_STATE"
  tmp=$(mktemp)
  if [ -f "$LAYR_ENV" ]; then
    grep -v '^LAYR_KIOSK_ENGINE=' "$LAYR_ENV" >"$tmp" || true
  fi
  printf 'LAYR_KIOSK_ENGINE=%s\n' "$engine" >>"$tmp"
  mv "$tmp" "$LAYR_ENV"
  chmod 600 "$LAYR_ENV"
  printf '%s\n' "$engine" >"$LAYR_STATE/saved-engine"
}

maybe_restart_kiosk() {
  [ "$RESTART_KIOSK" = 1 ] || return 0
  echo "Restarting layr-kiosk.service only. Klipper, Moonraker and KlipperScreen are not restarted."
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl is not available, so the kiosk was not restarted." >&2
    return 1
  fi
  sudo systemctl restart layr-kiosk.service
}

ACTION="${1:-status}"
shift || true
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --restart-kiosk) RESTART_KIOSK=1; shift ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [ -z "$TARGET" ]; then
        TARGET="$1"
        shift
      else
        echo "Unknown option: $1" >&2
        exit 1
      fi
      ;;
  esac
done

case "$ACTION" in
  status)
    echo "saved-engine: $(saved_engine)"
    if [ -f "$LAYR_STATE/last-engine" ]; then
      echo "last-started: $(tr -d '\n' <"$LAYR_STATE/last-engine")"
    else
      echo "last-started: unknown (the kiosk has not written one)"
    fi
    echo "env-file: $LAYR_ENV"
    ;;
  check)
    wpe_report
    ;;
  rollback)
    TARGET="chromium"
    ;&
  use)
    [ -n "$TARGET" ] || { echo "use chromium or use wpe" >&2; exit 1; }
    if ! engine=$(normalize_engine "$TARGET"); then
      echo "Unknown engine: $TARGET (use chromium or wpe)" >&2
      exit 1
    fi
    if [ "$engine" = "wpe" ]; then
      echo "Checking WPE without installing packages."
      if ! wpe_report; then
        echo "WPE is not usable. The saved engine was not changed." >&2
        exit 1
      fi
      echo "This saves WPE as the next kiosk engine. Chromium stays installed. The display does not change until the kiosk starts again."
      confirm "Save WPE as the kiosk engine?" || { echo "Cancelled" >&2; exit 1; }
    else
      echo "This saves Chromium as the kiosk engine."
      confirm "Save Chromium as the kiosk engine?" || { echo "Cancelled" >&2; exit 1; }
    fi
    write_engine "$engine"
    echo "Saved LAYR_KIOSK_ENGINE=$engine in $LAYR_ENV"
    maybe_restart_kiosk
    ;;
  *)
    echo "Unknown action: $ACTION (status, check, use, rollback)" >&2
    exit 1
    ;;
esac
