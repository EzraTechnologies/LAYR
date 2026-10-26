#!/usr/bin/env bash
# Switch the Pi's display between KlipperScreen and the LAYR kiosk.
#
#   ./deploy/layr-display.sh status
#   ./deploy/layr-display.sh to-layr [--yes]
#   ./deploy/layr-display.sh to-klipperscreen [--yes]
#
# KlipperScreen is never uninstalled. to-layr disables and stops it, and records that fact so
# uninstall.sh can turn it back on. to-klipperscreen stops the LAYR kiosk and enables KlipperScreen.
# Test LAYR in a browser (http://127.0.0.1:<port>/) before running to-layr.
set -euo pipefail
cd "$(dirname "$0")" || exit 1
# shellcheck source=deploy/lib.sh
. ./lib.sh

ACTION="${1:-status}"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

show_status() {
  for unit in "$KS_UNIT" "$KIOSK_UNIT" "$WEB_UNIT"; do
    if unit_exists "$unit"; then
      printf '  %-24s enabled=%-8s active=%s\n' "$unit" "$(systemctl is-enabled "$unit" 2>/dev/null || true)" "$(systemctl is-active "$unit" 2>/dev/null || true)"
    else
      printf '  %-24s not installed\n' "$unit"
    fi
  done
  if [ -f "$KS_MARKER" ]; then
    echo "  KlipperScreen was disabled by LAYR ($(cat "$KS_MARKER"))"
  fi
}

case "$ACTION" in
  status)
    show_status
    ;;
  to-layr)
    require_not_root
    unit_exists "$KIOSK_UNIT" || die "layr-kiosk.service is not installed. Run deploy/install.sh first."
    unit_exists "$WEB_UNIT" || die "layr-web.service is not installed. Run deploy/install.sh first."
    echo "This stops KlipperScreen and starts the LAYR kiosk on tty7."
    echo "KlipperScreen stays installed. Switch back with: ./deploy/layr-display.sh to-klipperscreen"
    confirm "Switch the display to LAYR?" || die "Cancelled"
    if unit_exists "$KS_UNIT" && { unit_active "$KS_UNIT" || unit_enabled "$KS_UNIT"; }; then
      if [ "$DRY_RUN" = 1 ]; then
        printf '   [dry-run] record that LAYR disabled %s\n' "$KS_UNIT"
      else
        mkdir -p "$LAYR_STATE"
        date -u +%Y-%m-%dT%H:%M:%SZ >"$KS_MARKER"
      fi
      run sudo systemctl disable --now "$KS_UNIT"
    fi
    run sudo systemctl enable --now "$KIOSK_UNIT"
    info "LAYR kiosk starting. Ctrl+Alt+F1 still reaches a text console."
    ;;
  to-klipperscreen)
    require_not_root
    echo "This stops the LAYR kiosk and enables KlipperScreen."
    confirm "Switch the display back to KlipperScreen?" || die "Cancelled"
    if unit_exists "$KIOSK_UNIT"; then
      run sudo systemctl disable --now "$KIOSK_UNIT"
    fi
    if unit_exists "$KS_UNIT"; then
      run sudo systemctl enable --now "$KS_UNIT"
    else
      warn "$KS_UNIT is not installed, so nothing was started on the display."
    fi
    run rm -f "$KS_MARKER"
    info "Display switched. The LAYR web server is still available in a browser."
    ;;
  *)
    die "Unknown action: $ACTION (use status, to-layr, or to-klipperscreen)"
    ;;
esac
