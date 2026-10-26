#!/usr/bin/env bash
# Shared helpers for the LAYR deploy scripts. Sourced, not executed.
# shellcheck disable=SC2034

LAYR_HOME="${LAYR_HOME:-$HOME/layr}"
LAYR_STATE="$LAYR_HOME/state"
LAYR_ENV="$LAYR_HOME/layr.env"
UNIT_DIR="/etc/systemd/system"
WEB_UNIT="layr-web.service"
KIOSK_UNIT="layr-kiosk.service"
KS_UNIT="KlipperScreen.service"
# Written by layr-display.sh when it disables KlipperScreen, so uninstall can restore it.
KS_MARKER="$LAYR_STATE/klipperscreen-disabled-by-layr"

DRY_RUN=0
ASSUME_YES=0

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWARNING:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

# Runs a command, or only prints it with --dry-run.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  [ "$DRY_RUN" = 1 ] && return 0
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

require_not_root() {
  [ "$(id -u)" != 0 ] || die "Run this as the printer user (for example 'pi'), not as root. It uses sudo where needed."
}

unit_exists() {
  systemctl list-unit-files --no-legend "$1" 2>/dev/null | grep -q "^$1"
}

unit_active() {
  systemctl is-active --quiet "$1" 2>/dev/null
}

unit_enabled() {
  systemctl is-enabled --quiet "$1" 2>/dev/null
}

browser_bin() {
  command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || true
}
