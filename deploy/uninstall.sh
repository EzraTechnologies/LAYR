#!/usr/bin/env bash
# Remove LAYR's systemd units. By default the ~/layr files are kept.
#
#   ./deploy/uninstall.sh [--purge] [--dry-run] [--yes]
#
# If deploy/layr-display.sh disabled KlipperScreen, this re-enables it. KlipperScreen's own
# files are never deleted. Printer configuration is never edited.
set -euo pipefail
cd "$(dirname "$0")" || exit 1
# shellcheck source=deploy/lib.sh
. ./lib.sh

PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_not_root

echo "This removes $WEB_UNIT and $KIOSK_UNIT."
if [ -f "$KS_MARKER" ]; then
  echo "KlipperScreen was disabled by LAYR and will be enabled again."
else
  echo "KlipperScreen will be left exactly as it is."
fi
if [ "$PURGE" = 1 ]; then
  echo "Also deletes $LAYR_HOME"
else
  echo "Keeps $LAYR_HOME (pass --purge to delete it)."
fi
confirm "Uninstall LAYR?" || die "Cancelled"

if unit_exists "$KIOSK_UNIT"; then
  run sudo systemctl disable --now "$KIOSK_UNIT" || true
fi
if unit_exists "$WEB_UNIT"; then
  run sudo systemctl disable --now "$WEB_UNIT" || true
fi
run sudo rm -f "$UNIT_DIR/$KIOSK_UNIT" "$UNIT_DIR/$WEB_UNIT"
run sudo systemctl daemon-reload

if [ -f "$KS_MARKER" ]; then
  if unit_exists "$KS_UNIT"; then
    info "Re-enabling KlipperScreen"
    run sudo systemctl enable --now "$KS_UNIT"
  else
    warn "Marker says LAYR disabled KlipperScreen, but $KS_UNIT is not installed. Nothing was started."
  fi
  run rm -f "$KS_MARKER"
fi

if [ "$PURGE" = 1 ]; then
  run rm -rf "$LAYR_HOME"
fi

info "LAYR units removed. Printer configuration was not modified."
