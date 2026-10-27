#!/usr/bin/env bash
# Install the native Qt kiosk unit, disabled.
#
#   ./kiosk-install.sh --dry-run --yes
#   ./kiosk-install.sh --yes
#
# What it does:
#   Copies a backup of an existing layr-qt-test.service, if that file is present.
#   Writes layr-qt.service for this user and this checkout (or ~/layr-native-qt/current).
#   Reloads systemd when installing on the machine (not in the test directory).
#
# What it never does:
#   Enable or start layr-qt.service
#   Stop layr-kiosk, KlipperScreen, layr-qt-test, Klipper, or Moonraker
#   Edit printer.cfg or moonraker.conf
#   Change the Chromium unit
#
# Switch the panel only with kiosk-switch.sh, after you mean to.
set -euo pipefail

ASSUME_YES=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the printer user, not root." >&2
  exit 2
fi
if [ "$ASSUME_YES" -ne 1 ]; then
  echo "Refusing to install without --yes. Nothing was changed." >&2
  exit 2
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SOURCE=$(cd "$SCRIPT_DIR/.." && pwd)
if [ -x "${HOME}/layr-native-qt/current/scripts/qt-kiosk.sh" ]; then
  ROOT=$(readlink -f "${HOME}/layr-native-qt/current")
else
  ROOT="$SOURCE"
fi
USER_NAME=$(id -un)
UNIT_NAME="layr-qt.service"
BACKUP_ROOT="${HOME}/layr-native-qt/backup"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

if [ -n "${LAYR_QT_ETC:-}" ]; then
  CANDIDATES=("${LAYR_QT_ETC}/systemd/system/layr-qt-test.service" "${HOME}/.config/systemd/user/layr-qt-test.service")
else
  CANDIDATES=("/etc/systemd/system/layr-qt-test.service" "${HOME}/.config/systemd/user/layr-qt-test.service")
fi

echo "Native Qt kiosk unit"
echo "  root: ${ROOT}"
echo "  user: ${USER_NAME}"
echo "  unit: ${UNIT_NAME} (not enabled, not started)"
for path in "${CANDIDATES[@]}"; do
  if [ -f "$path" ]; then
    echo "  backup: ${path} -> ${BACKUP_ROOT}/$(basename "$(dirname "$path")")-layr-qt-test.service.${STAMP}"
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run only. No files were written and no service was enabled or started."
  exit 0
fi

mkdir -p "$BACKUP_ROOT"
for path in "${CANDIDATES[@]}"; do
  if [ -f "$path" ]; then
    label=$(basename "$(dirname "$path")")
    cp -a "$path" "${BACKUP_ROOT}/${label}-layr-qt-test.service.${STAMP}"
    echo "Backed up ${path}"
  fi
done

RENDERED=$(mktemp)
sed \
  -e "s|@USER@|${USER_NAME}|g" \
  -e "s|@ROOT@|${ROOT}|g" \
  -e "s|@HOME@|${HOME}|g" \
  "${SOURCE}/systemd/layr-qt.service.in" >"$RENDERED"

if [ -n "${LAYR_QT_SYSTEMD_DIR:-}" ]; then
  mkdir -p "$LAYR_QT_SYSTEMD_DIR"
  cp "$RENDERED" "${LAYR_QT_SYSTEMD_DIR}/${UNIT_NAME}"
  rm -f "$RENDERED"
  echo "Wrote ${LAYR_QT_SYSTEMD_DIR}/${UNIT_NAME}"
  echo "Test mode: systemd was not reloaded. The unit was not enabled or started."
  exit 0
fi

sudo cp "$RENDERED" "/etc/systemd/system/${UNIT_NAME}"
rm -f "$RENDERED"
sudo systemctl daemon-reload
echo "Installed ${UNIT_NAME}. It is not enabled and it was not started."
echo "The panel is unchanged. Switch with: ${ROOT}/scripts/kiosk-switch.sh to-qt --yes"
