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
require_complete_script "$PWD/layr-display.sh"
require_complete_script "$PWD/lib.sh"
DEPLOY_DIR=$PWD

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

# Read-only. A failure here must happen before KlipperScreen is stopped.
kiosk_prereqs() {
  local port
  unit_exists "$KIOSK_UNIT" || die "layr-kiosk.service is not installed. Run deploy/install.sh first. KlipperScreen was not stopped."
  unit_exists "$WEB_UNIT" || die "layr-web.service is not installed. Run deploy/install.sh first. KlipperScreen was not stopped."
  if ! unit_active "$WEB_UNIT"; then
    die "layr-web.service is not running. Refusing to stop KlipperScreen."
  fi
  command -v curl >/dev/null 2>&1 || die "curl is not installed. Refusing to stop KlipperScreen."
  command -v cage >/dev/null 2>&1 || die "cage is not installed. Refusing to stop KlipperScreen."
  [ -n "$(browser_bin)" ] || die "Chromium is not installed. Refusing to stop KlipperScreen. This installer does not use the optional WebKit port."
  port=$(layr_web_port)
  if ! curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${port}/"; then
    die "The LAYR page did not answer on 127.0.0.1:${port}. Refusing to stop KlipperScreen."
  fi
}

wait_for_kiosk() {
  local tries="${LAYR_KIOSK_WAIT_SECS:-20}"
  local pause="${LAYR_KIOSK_WAIT_INTERVAL:-1}"
  local i
  case "$tries" in
    '' | *[!0-9]*) tries=20 ;;
  esac
  case "$pause" in
    '' | *[!0-9]*) pause=1 ;;
  esac
  [ "$tries" -ge 1 ] || tries=1
  i=1
  while [ "$i" -le "$tries" ]; do
    if unit_active "$KIOSK_UNIT"; then
      return 0
    fi
    sleep "$pause"
    i=$((i + 1))
  done
  return 1
}

restore_display() {
  warn "The LAYR kiosk did not stay running. Turning KlipperScreen back on so the panel is not left blank."
  if unit_exists "$KIOSK_UNIT"; then
    run sudo systemctl disable --now "$KIOSK_UNIT" || true
  fi
  if unit_exists "$KS_UNIT"; then
    run sudo systemctl enable --now "$KS_UNIT" || true
  else
    warn "KlipperScreen is not installed. A text console is: sudo chvt 1"
  fi
  run rm -f "$KS_MARKER"
  print_recovery_instructions "$DEPLOY_DIR"
}

case "$ACTION" in
  status)
    show_status
    ;;
  to-layr)
    require_not_root
    kiosk_prereqs
    echo "This stops KlipperScreen and starts the LAYR kiosk on tty7."
    echo "The Pi is not rebooted. Klipper, Moonraker, AFC, Happy Hare, printer.cfg, and moonraker.conf are not changed."
    echo "If the kiosk does not stay up, KlipperScreen is turned back on."
    echo "KlipperScreen stays installed. Switch back with: ${DEPLOY_DIR}/layr-display.sh to-klipperscreen --yes"
    print_recovery_instructions "$DEPLOY_DIR"
    confirm "Switch the display to LAYR?" || die "Cancelled. KlipperScreen was not stopped."
    if unit_exists "$KS_UNIT" && { unit_active "$KS_UNIT" || unit_enabled "$KS_UNIT"; }; then
      if [ "$DRY_RUN" = 1 ]; then
        printf '   [dry-run] record that LAYR disabled %s\n' "$KS_UNIT"
      else
        mkdir -p "$LAYR_STATE"
        date -u +%Y-%m-%dT%H:%M:%SZ >"$KS_MARKER"
      fi
      if ! run sudo systemctl disable --now "$KS_UNIT"; then
        die "Could not stop KlipperScreen. The kiosk was not started."
      fi
    fi
    if ! run sudo systemctl enable --now "$KIOSK_UNIT"; then
      if [ "$DRY_RUN" != 1 ]; then
        restore_display
      fi
      die "layr-kiosk.service did not start. The display was restored when that was possible."
    fi
    if [ "$DRY_RUN" = 1 ]; then
      info "Dry run. KlipperScreen was not stopped and the kiosk was not started."
      exit 0
    fi
    if ! wait_for_kiosk; then
      restore_display
      die "The LAYR kiosk did not stay active. KlipperScreen was turned back on when it is installed."
    fi
    info "LAYR kiosk is active. Ctrl+Alt+F1 still reaches a text console."
    print_recovery_instructions "$DEPLOY_DIR"
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
# LAYR_SCRIPT_END
