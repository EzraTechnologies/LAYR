#!/usr/bin/env bash
# Point ~/layr-native-qt/current back at the previous release.
# Does not stop or start any display service.
set -euo pipefail

ASSUME_YES=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$ASSUME_YES" -ne 1 ]; then
  echo "Refusing to roll back without --yes. Nothing was changed." >&2
  exit 2
fi

DEST_ROOT="${HOME}/layr-native-qt"
MANIFEST="${DEST_ROOT}/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "No ${MANIFEST}. Nothing to roll back." >&2
  exit 1
fi

python3 - "$MANIFEST" "$DEST_ROOT" "$DRY_RUN" <<'PY'
import json
import os
import sys
from pathlib import Path

manifest_path, dest_root, dry = sys.argv[1:]
manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
current = Path(dest_root) / "current"
previous = manifest.get("previous")
print(f"Current:  {current}")
print(f"Previous: {previous or 'none'}")
if dry == "1":
    print("Dry run only. No files were changed.")
    raise SystemExit(0)
if current.is_symlink() or current.exists():
    current.unlink()
if previous:
    previous_path = Path(previous)
    if not previous_path.exists():
        print(f"Previous release is missing: {previous}", file=sys.stderr)
        raise SystemExit(1)
    os.symlink(previous, current)
    print(f"Restored {current} -> {previous}")
else:
    print("Removed the current link. No earlier native release was recorded.")
print("Display services were not changed.")
PY
