#!/usr/bin/env bash
# Install LAYR onto a Raspberry Pi (or any Debian-like host) as a localhost static site.
#
#   ./deploy/install.sh [--dist DIR] [--port N] [--moonraker URL]
#                       [--dry-run] [--yes] [--reload-kiosk] [--ignore-hdmi-pointers]
#
# What it does:
#   - Copies a pre-built dist/ into ~/layr/releases/<timestamp> and points ~/layr/current at it.
#   - Installs layr-web.service (python http.server bound to 127.0.0.1) and enables it.
#   - Installs layr-kiosk.service but does NOT enable or start it.
#   - Refreshes ~/layr/bin. The kiosk URL includes layr_build set to that release directory name.
#
# What it never does:
#   - Edit printer.cfg, moonraker.conf, mmu.cfg, or any Klipper/Moonraker file.
#   - Install or configure AFC, Happy Hare, Box Turtle, or any other filament controller.
#   - Stop, disable, or replace KlipperScreen.
#   - Restart Klipper or Moonraker.
#   - Restart an already running kiosk unless --reload-kiosk is passed.
#     That flag restarts layr-kiosk.service only when the unit is already active.
#   - Open a port on the network. The UI is reachable only from this machine.
#   - Install a udev input rule unless --ignore-hdmi-pointers is passed.
#     That flag still writes nothing when no vc4-hdmi pointing stick is present,
#     and it does not overwrite a rule file LAYR did not write.
#
# Build on a workstation first (`npm ci && npm run build`), copy the repo or dist/ to the Pi,
# then run this script as the printer user (the same user that owns printer_data). Test in a
# normal browser before switching the display with deploy/layr-display.sh.
#
# --dist is resolved from the directory you ran the script in (or as an absolute path).
# The default is the dist/ directory next to deploy/. Re-running this script refreshes
# ~/layr/bin (the kiosk launcher). It does not restart Klipper or Moonraker.
set -euo pipefail
CALLER_PWD=$(pwd)
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$SCRIPT_DIR" || exit 1
# shellcheck source=deploy/lib.sh
. ./lib.sh
require_complete_script "$SCRIPT_DIR/install.sh"
require_complete_script "$SCRIPT_DIR/lib.sh"

# Empty means "the dist directory next to this script", resolved after the caller cwd is known.
DIST_ARG=""
PORT=7180
MOONRAKER="http://localhost:7125"
RELOAD_KIOSK=0
IGNORE_HDMI=0

usage() {
  cat <<'EOF'
Usage: ./deploy/install.sh [--dist DIR] [--port N] [--moonraker URL]
                           [--dry-run] [--yes] [--reload-kiosk] [--ignore-hdmi-pointers]

--reload-kiosk            Restart layr-kiosk.service only if it is already active.
                          Does not start a disabled kiosk. Does not restart Klipper,
                          Moonraker, or KlipperScreen.
--ignore-hdmi-pointers    Opt in to the vc4-hdmi pointing-stick udev rule when those
                          devices are present. Without this flag, no input rule is written.
                          An existing rule this script did not write is left in place.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dist) DIST_ARG="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --moonraker) MOONRAKER="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --reload-kiosk) RELOAD_KIOSK=1; shift ;;
    --ignore-hdmi-pointers) IGNORE_HDMI=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_not_root

case "$PORT" in
  '' | *[!0-9]*) die "Port must be a number" ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then die "Port out of range"; fi
if [ "$PORT" = 7125 ]; then die "Port 7125 is Moonraker's. Pick another, such as 7180."; fi

case "$MOONRAKER" in
  http://* | https://*) ;;
  *) die "Moonraker URL must start with http:// or https://" ;;
esac
case "$MOONRAKER" in
  *@*) die "Do not put a username or password in the Moonraker URL" ;;
esac

DIST=$(resolve_dist "$CALLER_PWD" "$SCRIPT_DIR" "$DIST_ARG") || die "Build directory not found. Run 'npm run build' and pass --dist."
[ -f "$DIST/index.html" ] || die "No index.html in $DIST. Run 'npm run build' first."

USER_NAME=$(id -un)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE="$LAYR_HOME/releases/$STAMP"

info "LAYR will be installed for $USER_NAME"
echo "  files:    $RELEASE"
echo "  url:      http://127.0.0.1:${PORT}/?moonraker=${MOONRAKER}&layr_build=${STAMP}#/home"
echo "  kiosk:    installed, left disabled (KlipperScreen is not touched)"
echo
confirm "Install now?" || die "Cancelled"

if [ "$DRY_RUN" = 1 ]; then
  info "Dry run only. No files or services will be changed."
fi

run mkdir -p "$LAYR_HOME/releases" "$LAYR_HOME/bin" "$LAYR_STATE"
run cp -a "$DIST" "$RELEASE"
# Every install refreshes the launcher. rollback.sh only moves the web symlink, not these files.
for launcher in layr-kiosk.sh kiosk-lib.sh layr-engine.sh layr-hdmi-input.sh read-hide-cursor.py blank-cursor.py; do
  run cp -a "./$launcher" "$LAYR_HOME/bin/$launcher"
  run chmod 755 "$LAYR_HOME/bin/$launcher"
done

if [ -L "$LAYR_HOME/current" ] || [ -d "$LAYR_HOME/current" ]; then
  previous=$(readlink -f "$LAYR_HOME/current" || true)
  if [ -n "${previous:-}" ] && [ -d "$previous" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      printf '   [dry-run] record previous release %s\n' "$previous"
    else
      printf '%s\n' "$previous" >"$LAYR_STATE/previous"
    fi
  fi
fi
run ln -sfn "$RELEASE" "$LAYR_HOME/current"

if [ "$DRY_RUN" = 1 ]; then
  printf '   [dry-run] write %s (keep every key except LAYR_PORT and LAYR_MOONRAKER_URL)\n' "$LAYR_ENV"
else
  write_layr_env "$LAYR_ENV" "$PORT" "$MOONRAKER"
fi

render_unit() {
  local src="$1" dest="$2"
  local rendered
  rendered=$(mktemp)
  sed \
    -e "s|@USER@|${USER_NAME}|g" \
    -e "s|@PORT@|${PORT}|g" \
    -e "s|@LAYR_HOME@|${LAYR_HOME}|g" \
    -e "s|@WEB_UNIT@|${WEB_UNIT}|g" \
    -e "s|@KS_UNIT@|${KS_UNIT}|g" \
    "$src" >"$rendered"
  run sudo install -m 644 "$rendered" "$dest"
  rm -f "$rendered"
}

render_unit ./systemd/layr-web.service.in "$UNIT_DIR/$WEB_UNIT"
render_unit ./systemd/layr-kiosk.service.in "$UNIT_DIR/$KIOSK_UNIT"
run sudo systemctl daemon-reload
run sudo systemctl enable "$WEB_UNIT"
# Restart only the static file server so an upgrade is what the browser loads.
# This does not restart Klipper, Moonraker, or the kiosk.
if unit_active "$WEB_UNIT"; then
  run sudo systemctl restart "$WEB_UNIT"
else
  run sudo systemctl start "$WEB_UNIT"
fi
# A first install leaves the kiosk disabled. An upgrade must not disable a kiosk
# that layr-display.sh already turned on. The kiosk is restarted only with --reload-kiosk,
# and only when that unit is already active.
if unit_enabled "$KIOSK_UNIT"; then
  if [ "$RELOAD_KIOSK" = 1 ]; then
    info "layr-kiosk.service is already enabled."
  else
    info "layr-kiosk.service is already enabled. It is left enabled and is not restarted."
  fi
else
  run sudo systemctl disable "$KIOSK_UNIT" || true
fi

if [ "$IGNORE_HDMI" = 1 ]; then
  info "Opt-in HDMI pointer rule requested. Touchscreens and mice are not matched."
  if [ "$DRY_RUN" = 1 ] && [ "$ASSUME_YES" = 1 ]; then
    "$SCRIPT_DIR/layr-hdmi-input.sh" apply --dry-run --yes
  elif [ "$DRY_RUN" = 1 ]; then
    "$SCRIPT_DIR/layr-hdmi-input.sh" apply --dry-run
  elif [ "$ASSUME_YES" = 1 ]; then
    "$SCRIPT_DIR/layr-hdmi-input.sh" apply --yes
  else
    "$SCRIPT_DIR/layr-hdmi-input.sh" apply
  fi
fi

if [ "$RELOAD_KIOSK" = 1 ]; then
  reload_active_kiosk
else
  echo "layr-kiosk.service was not restarted. An already running kiosk keeps the previous page until it starts again."
  echo "The next start loads layr_build=${STAMP}. Rollback points current at the previous release directory, so that value changes back."
  echo "Reload only the kiosk with --reload-kiosk, or: sudo systemctl restart layr-kiosk"
fi

info "Web UI is (or would be) at http://127.0.0.1:${PORT}/?moonraker=${MOONRAKER}&layr_build=${STAMP}#/home"
echo "The kiosk uses the same layr_build value, percent-encoded, and keeps the #/home route."
echo "Open that address in Chromium on this Pi before using the kiosk."
echo "KlipperScreen was not modified. To switch displays later: ./deploy/layr-display.sh to-layr"
echo "To undo this install: ./deploy/uninstall.sh"
print_recovery_instructions "$SCRIPT_DIR"
# LAYR_SCRIPT_END
