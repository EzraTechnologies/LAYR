#!/usr/bin/env bash
# Remove LAYR's systemd units. By default the ~/layr files and the layr command are kept.
#
#   ./deploy/uninstall.sh [--purge] [--dry-run] [--yes]
#   ./deploy/uninstall.sh --remove-command-only [--yes]
#
# --purge also deletes ~/layr and the layr command after the units are gone.
# It does not delete personal settings or printer photos, and it does not remove apt packages.
# If deploy/layr-display.sh disabled KlipperScreen, this re-enables it. KlipperScreen's own
# files are never deleted. Printer configuration is never edited.
set -euo pipefail
cd "$(dirname "$0")" || exit 1
# shellcheck source=deploy/lib.sh
. ./lib.sh
require_complete_script "$PWD/uninstall.sh"
require_complete_script "$PWD/lib.sh"

PURGE=0
REMOVE_COMMAND_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --remove-command-only) REMOVE_COMMAND_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_not_root

if [ "$REMOVE_COMMAND_ONLY" = 1 ]; then
  remove_layr_command
  exit 0
fi

unit_dir_allowed() {
  case "$UNIT_DIR" in
    /etc/systemd/system | /usr/lib/systemd/system | /lib/systemd/system) return 0 ;;
  esac
  case "$UNIT_DIR" in
    "$HOME"/*) return 0 ;;
  esac
  return 1
}

if ! unit_dir_allowed; then
  die "Refusing to remove units from $UNIT_DIR. Nothing was changed."
fi
if [ "$PURGE" = 1 ]; then
  case "$LAYR_HOME" in
    "$HOME"/*) ;;
    *) die "Refusing to delete $LAYR_HOME. Nothing was changed." ;;
  esac
  if [ "$(basename "$LAYR_HOME")" != "layr" ] || [ "$LAYR_HOME" = "$HOME" ]; then
    die "Refusing to delete $LAYR_HOME. Nothing was changed."
  fi
fi

echo "This removes $WEB_UNIT and $KIOSK_UNIT."
if [ -f "$KS_MARKER" ]; then
  echo "KlipperScreen was disabled by LAYR and will be enabled again."
else
  echo "KlipperScreen will be left exactly as it is."
fi
if [ "$PURGE" = 1 ]; then
  echo "Also deletes $LAYR_HOME and the layr command."
  echo "Personal settings and printer photos in ~/.config/layr-chromium are kept."
else
  echo "Keeps $LAYR_HOME and the layr command (pass --purge to delete the LAYR files and the command)."
fi
echo "Apt packages, Klipper, Moonraker, AFC, Happy Hare, and printer configuration are kept."
if [ -f "$HDMI_POINTER_RULE_PATH" ]; then
  echo "Leaves the udev rule at $HDMI_POINTER_RULE_PATH in place."
  echo "Uninstall does not delete that file. A rule already on this Pi stays until you remove it yourself."
  echo "A LAYR-managed rule can be removed with ./deploy/layr-hdmi-input.sh remove"
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
  run rm -rf "$LAYR_HOME" || die "Could not delete $LAYR_HOME. The layr command was left in place."
  remove_layr_command
fi

info "LAYR units removed. Printer configuration was not modified."
print_recovery_instructions "$PWD"
# LAYR_SCRIPT_END
