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

# Opt-in udev rule for Raspberry Pi vc4-hdmi virtual pointing sticks.
# Tests set LAYR_UDEV_RULES_PATH. A Pi leaves it unset.
HDMI_POINTER_RULE_NAME="99-layr-ignore-hdmi-pointers.rules"
HDMI_POINTER_RULE_PATH="${LAYR_UDEV_RULES_PATH:-/etc/udev/rules.d/${HDMI_POINTER_RULE_NAME}}"

# Restart layr-kiosk only when it is already active.
# Does not start a disabled kiosk. Does not restart Klipper, Moonraker, or KlipperScreen.
reload_active_kiosk() {
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl is not available, so layr-kiosk was not reloaded."
    return 1
  fi
  if ! unit_active "$KIOSK_UNIT"; then
    info "layr-kiosk.service is not active, so it was not started."
    return 0
  fi
  info "Reloading layr-kiosk.service only. Klipper, Moonraker, and KlipperScreen are not restarted."
  run sudo systemctl restart "$KIOSK_UNIT"
}

# Refuse a truncated download. The marker is the last non-empty line of the file.
# Call this before any install or display change.
require_complete_script() {
  local file="$1"
  local marker="${2:-# LAYR_SCRIPT_END}"
  local last=""
  [ -f "$file" ] || die "Refusing to run $file: the file is missing. Nothing was changed."
  last=$(awk 'NF { line = $0 } END { print line }' "$file")
  if [ "$last" != "$marker" ]; then
    die "Refusing to run an incomplete copy of $file. Download it again. Nothing was changed."
  fi
}

layr_web_port() {
  local line=""
  if [ -f "$LAYR_ENV" ]; then
    line=$(grep -E '^LAYR_PORT=[0-9]+$' "$LAYR_ENV" | tail -n 1 || true)
  fi
  if [ -n "$line" ]; then
    printf '%s\n' "${line#LAYR_PORT=}"
  else
    printf '7180\n'
  fi
}

# Printed before a display switch and again if that switch is undone.
print_recovery_instructions() {
  local deploy_dir="${1:-deploy}"
  cat <<EOF

If the panel is blank or on the wrong screen, the Pi was not rebooted.
Run these as the printer user, not as root. KlipperScreen stays installed:

  ${HOME}/layr/bin/layr status
  ${HOME}/layr/bin/layr to-klipperscreen
  ${deploy_dir}/layr-display.sh to-klipperscreen --yes
  ${deploy_dir}/rollback.sh --yes
  ${deploy_dir}/uninstall.sh

Those commands do not edit printer.cfg, moonraker.conf, mmu.cfg, or AFC / Box Turtle / Happy Hare files.
layr does not download the installer. It runs the copy already stored on this Pi.
A text console is Ctrl+Alt+F1, or: sudo chvt 1
EOF
}

# LAYR_SCRIPT_END
