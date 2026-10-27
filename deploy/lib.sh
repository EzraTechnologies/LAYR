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

# Resolve a --dist path.
# Empty means <script dir>/../dist (the repo build). Absolute paths stay absolute.
# Anything else is relative to the directory the user ran the script from, not to deploy/.
resolve_dist() {
  local caller_pwd="$1" script_dir="$2" dist="${3-}"
  if [ -z "$dist" ]; then
    dist="$script_dir/../dist"
  else
    case "$dist" in
      /*) ;;
      *) dist="$caller_pwd/$dist" ;;
    esac
  fi
  (cd "$dist" 2>/dev/null && pwd)
}

# Rewrite port and Moonraker URL. Every other KEY=VALUE line is kept, including
# LAYR_KIOSK_ENGINE and LAYR_HIDE_CURSOR, so an upgrade does not drop them.
write_layr_env() {
  local dest="$1" port="$2" moonraker="$3" tmp line
  tmp=$(mktemp)
  if [ -f "$dest" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        LAYR_PORT=* | LAYR_MOONRAKER_URL=* | '') ;;
        *) printf '%s\n' "$line" >>"$tmp" ;;
      esac
    done <"$dest"
  fi
  {
    printf 'LAYR_PORT=%s\n' "$port"
    printf 'LAYR_MOONRAKER_URL=%s\n' "$moonraker"
    if [ -s "$tmp" ]; then
      cat "$tmp"
    fi
  } >"$dest"
  rm -f "$tmp"
  chmod 600 "$dest"
}
