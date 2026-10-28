#!/usr/bin/env bash
# Offscreen fixture grabs. These are not photographs of a printer or a Pi.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
OUT="${ROOT}/docs/screenshots"
mkdir -p "$OUT"
export QT_QPA_PLATFORM=offscreen
export QT_QUICK_BACKEND=software
export QSG_RENDER_LOOP=basic
export PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
cd "$ROOT"
python3 -m layr_qt --fixture printing --geometry 1024x600 --screenshot "$OUT/1024x600-home.png"
python3 -m layr_qt --fixture ready --geometry 1024x600 --screenshot "$OUT/1024x600-ready.png"
python3 -m layr_qt --fixture files --geometry 1024x600 --page files --screenshot "$OUT/1024x600-files.png"
python3 -m layr_qt --fixture controls --geometry 1024x600 --page controls --screenshot "$OUT/1024x600-controls.png"
python3 -m layr_qt --fixture ready --geometry 1024x600 --page move --screenshot "$OUT/1024x600-move.png"
python3 -m layr_qt --fixture printing --geometry 1024x600 --page heat --screenshot "$OUT/1024x600-heat.png"
python3 -m layr_qt --fixture printing --geometry 1024x600 --page more --screenshot "$OUT/1024x600-more.png"
python3 -m layr_qt --fixture settings --geometry 1024x600 --page settings --screenshot "$OUT/1024x600-settings.png"
python3 -m layr_qt --fixture ready --geometry 800x480 --page move --screenshot "$OUT/800x480-move.png"
python3 -m layr_qt --fixture printing --geometry 800x480 --screenshot "$OUT/800x480-home.png"
python3 -m layr_qt --fixture offline --geometry 800x480 --screenshot "$OUT/800x480-offline.png"
python3 -m layr_qt --fixture settings --geometry 800x480 --page settings --screenshot "$OUT/800x480-settings.png"
python3 -m layr_qt --fixture printing --geometry 1024x600 --page filament --screenshot "$OUT/1024x600-filament.png"
python3 -m layr_qt --fixture ready --geometry 800x480 --page filament --screenshot "$OUT/800x480-filament.png"
python3 -m layr_qt --fixture offline --geometry 800x480 --page filament --screenshot "$OUT/800x480-filament-offline.png"
echo "Wrote fixture screenshots in ${OUT}"
