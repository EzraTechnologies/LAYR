#!/usr/bin/env bash
# Legacy compatibility launcher. New installs should use deploy/layr-installer.sh.
# Existing published bootstrap.sh links remain supported.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -f "$SCRIPT_DIR/layr-installer.sh" ]; then
  exec bash "$SCRIPT_DIR/layr-installer.sh" "$@"
fi

# Standalone download of the historical GitHub URL: obtain the canonical installer.
command -v curl >/dev/null 2>&1 || {
  printf 'ERROR: curl is needed to fetch layr-installer.sh.\n' >&2
  exit 1
}
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/EzraTechnologies/LAYR/main/deploy/layr-installer.sh -o "$tmp"
bash "$tmp" "$@"
# LAYR_SCRIPT_END
