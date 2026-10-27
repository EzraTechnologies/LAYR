#!/usr/bin/env bash
# Unit tests, plus an offscreen QML load when PyQt6 is installed.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$ROOT"
python3 -m compileall -q layr_qt tests
python3 -m pytest -q
if python3 -c 'import PyQt6.QtQuick' >/dev/null 2>&1; then
  QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software QSG_RENDER_LOOP=basic \
    python3 -m layr_qt --self-check --geometry 1024x600
fi
echo "verify ok"
