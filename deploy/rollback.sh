#!/usr/bin/env bash
# Point ~/layr/current back at the release recorded by the previous install.sh.
# Restarts layr-web if it is active. Does not change the kiosk, KlipperScreen, or printer configuration.
#
#   ./deploy/rollback.sh [--dry-run] [--yes]
set -euo pipefail
cd "$(dirname "$0")" || exit 1
# shellcheck source=deploy/lib.sh
. ./lib.sh

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h | --help) sed -n '2,6p' "$0"; exit 0 ;;
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
info "Rolled back. Reload the browser tab. The display session was left as it was."
