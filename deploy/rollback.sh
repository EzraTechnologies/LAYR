#!/usr/bin/env bash
# Point ~/layr/current back at the release recorded by the previous install.sh.
# Restarts layr-web if it is active. Does not restart the kiosk unless --reload-kiosk
# is passed. Does not change KlipperScreen, Klipper, Moonraker, or printer configuration.
#
#   ./deploy/rollback.sh [--dry-run] [--yes] [--reload-kiosk]
#
# The kiosk reads layr_build from the current release directory the next time it starts.
# --reload-kiosk restarts layr-kiosk.service only when that unit is already active.
set -euo pipefail
cd "$(dirname "$0")" || exit 1
# shellcheck source=deploy/lib.sh
. ./lib.sh
require_complete_script "$PWD/rollback.sh"
require_complete_script "$PWD/lib.sh"

RELOAD_KIOSK=0

usage() {
  cat <<'EOF'
Usage: ./deploy/rollback.sh [--dry-run] [--yes] [--reload-kiosk]

Point ~/layr/current at the previous release. layr-web is restarted if it is active.
--reload-kiosk restarts layr-kiosk.service only when that unit is already active.
Klipper, Moonraker, and KlipperScreen are not restarted.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --reload-kiosk) RELOAD_KIOSK=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_not_root
[ -f "$LAYR_STATE/previous" ] || die "No previous release recorded in $LAYR_STATE/previous"
previous=$(tr -d '\n' <"$LAYR_STATE/previous")
[ -d "$previous" ] || die "Previous release is missing: $previous"
current=$(readlink -f "$LAYR_HOME/current" 2>/dev/null || true)
[ "$current" != "$previous" ] || die "Already on that release ($previous)"

info "Roll back ~/layr/current"
echo "  from: ${current:-<none>}"
echo "  to:   $previous"
confirm "Roll back now?" || die "Cancelled"

run ln -sfn "$previous" "$LAYR_HOME/current"
if [ -n "${current:-}" ] && [ -d "$current" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry-run] record %s as the new previous release\n' "$current"
  else
    printf '%s\n' "$current" >"$LAYR_STATE/previous"
  fi
fi

if unit_active "$WEB_UNIT"; then
  run sudo systemctl restart "$WEB_UNIT"
fi
if [ "$RELOAD_KIOSK" = 1 ]; then
  reload_active_kiosk
  info "Rolled back. layr_build follows the release directory now at $LAYR_HOME/current."
else
  info "Rolled back. The kiosk was not restarted, so the panel keeps the previous page until layr-kiosk starts again."
  echo "The next start uses layr_build from the release directory now at $LAYR_HOME/current."
  echo "Reload only the kiosk with: sudo systemctl restart layr-kiosk"
  echo "Or: ./deploy/rollback.sh --reload-kiosk --yes"
fi
print_recovery_instructions "$PWD"
# LAYR_SCRIPT_END
