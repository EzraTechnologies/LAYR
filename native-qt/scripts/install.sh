#!/usr/bin/env bash
# Opt-in copy of the native Qt prototype into $HOME/layr-native-qt.
#
#   ./scripts/install.sh --dry-run --yes
#   ./scripts/install.sh --yes
#
# What it does:
#   Copies this directory to ~/layr-native-qt/releases/<timestamp>
#   Points ~/layr-native-qt/current at that copy
#   Records the previous target in ~/layr-native-qt/manifest.json
#
# What it never does:
#   Install or start a service
#   Stop layr-web, layr-kiosk, or KlipperScreen
#   Edit Klipper or Moonraker configuration
#   Change the panel that is currently showing
set -euo pipefail

ASSUME_YES=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
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
DEST_ROOT="${HOME}/layr-native-qt"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE="${DEST_ROOT}/releases/${STAMP}"
suffix=2
while [ -e "$RELEASE" ]; do
  RELEASE="${DEST_ROOT}/releases/${STAMP}-${suffix}"
  suffix=$((suffix + 1))
done
CURRENT="${DEST_ROOT}/current"
PREVIOUS=""
if [ -L "$CURRENT" ]; then
  PREVIOUS=$(readlink -f "$CURRENT" || true)
fi

echo "Native Qt prototype install"
echo "  from:     ${SOURCE}"
echo "  release:  ${RELEASE}"
echo "  previous: ${PREVIOUS:-none}"
echo "  services: not touched"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run only. No files were written."
  exit 0
fi

mkdir -p "${DEST_ROOT}/releases"
mkdir -p "$RELEASE"
cp -a "${SOURCE}/." "$RELEASE/"
find "$RELEASE" -type d \( -name '__pycache__' -o -name '.pytest_cache' \) -prune -exec rm -rf {} +
ln -sfn "$RELEASE" "$CURRENT"
if [ -n "$PREVIOUS" ]; then
  PREV_JSON="\"${PREVIOUS}\""
else
  PREV_JSON=null
fi
cat > "${DEST_ROOT}/manifest.json" <<EOF
{"release":"${RELEASE}","previous":${PREV_JSON},"installedAt":"${STAMP}"}
EOF
echo "Installed. Launch with: ${CURRENT}/scripts/launch-session.sh"
echo "Undo with: ${CURRENT}/scripts/rollback.sh --yes"
