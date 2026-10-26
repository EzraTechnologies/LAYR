#!/usr/bin/env bash
# Read-only diagnostics for a LAYR kiosk target. Changes nothing on the system.
#
#   ./deploy/check-device.sh [--moonraker http://localhost:7125]
#
# Reports the Pi model, OS, display connectors and modes, touch devices, KlipperScreen and Moonraker state,
# Moonraker authorization settings relevant to LAYR, and whether cage/Chromium are installed.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
# shellcheck source=deploy/lib.sh
. ./lib.sh

MOONRAKER="http://localhost:7125"
while [ $# -gt 0 ]; do
  case "$1" in
    --moonraker) MOONRAKER="$2"; shift 2 ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

section() { printf '\n\033[1m%s\033[0m\n' "$*"; }

section "Hardware"
if [ -r /proc/device-tree/model ]; then
  printf '  Model: %s\n' "$(tr -d '\0' </proc/device-tree/model)"
else
  echo "  Model: unknown (not a Raspberry Pi device tree)"
fi
printf '  Kernel: %s  Arch: %s\n' "$(uname -r)" "$(uname -m)"
# shellcheck disable=SC1091
[ -r /etc/os-release ] && printf '  OS: %s\n' "$(. /etc/os-release && echo "$PRETTY_NAME")"
printf '  Memory: %s MB\n' "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"

section "Display (DRM/KMS connectors)"
found=0
for status in /sys/class/drm/card*-*/status; do
  [ -e "$status" ] || continue
  found=1
  dir=$(dirname "$status")
  printf '  %s: %s\n' "$(basename "$dir")" "$(cat "$status")"
  if [ "$(cat "$status")" = connected ] && [ -r "$dir/modes" ]; then
    printf '    preferred mode: %s\n' "$(head -n1 "$dir/modes")"
    printf '    all modes: %s\n' "$(tr '\n' ' ' <"$dir/modes")"
  fi
done
[ "$found" = 1 ] || echo "  No DRM connectors found (KMS driver not loaded?)"
echo "  LAYR does not assume a resolution; cage uses the connector's preferred mode."

section "Touch / input devices"
if [ -r /proc/bus/input/devices ]; then
  awk -F= '/^N: Name=/ {name=$2} /^H: Handlers=/ { if ($0 ~ /mouse|event/) print "  " name " -> " $2 }' /proc/bus/input/devices
else
  echo "  /proc/bus/input/devices not readable"
fi

section "Display services"
for unit in "$KS_UNIT" "$KIOSK_UNIT" "$WEB_UNIT"; do
  if unit_exists "$unit"; then
    printf '  %-24s enabled=%-8s active=%s\n' "$unit" "$(systemctl is-enabled "$unit" 2>/dev/null)" "$(systemctl is-active "$unit" 2>/dev/null)"
  else
    printf '  %-24s not installed\n' "$unit"
  fi
done
printf '  default target: %s\n' "$(systemctl get-default 2>/dev/null || echo unknown)"

section "Kiosk software"
printf '  cage: %s\n' "$(command -v cage || echo 'not installed (sudo apt install cage)')"
printf '  chromium: %s\n' "$(browser_bin | grep . || echo 'not installed (sudo apt install chromium-browser or chromium)')"
printf '  python3: %s\n' "$(command -v python3 || echo 'not installed')"
printf '  user groups: %s\n' "$(id -nG)"

section "Moonraker ($MOONRAKER)"
if command -v curl >/dev/null; then
  if info_json=$(curl -fsS --max-time 5 "$MOONRAKER/server/info" 2>/dev/null); then
    echo "  reachable: yes"
    printf '  %s\n' "$(printf '%s' "$info_json" | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print("klippy_state=%s moonraker=%s" % (r.get("klippy_state"), r.get("moonraker_version")))' 2>/dev/null)"
  else
    echo "  reachable: NO (or this client is not trusted; see [authorization] below)"
  fi
fi

conf=""
for candidate in "$HOME/printer_data/config/moonraker.conf" "$HOME/klipper_config/moonraker.conf"; do
  [ -r "$candidate" ] && conf="$candidate" && break
done
if [ -n "$conf" ]; then
  echo "  config: $conf (read only)"
  awk '/^\[authorization\]/{p=1; print "    " $0; next} /^\[/{p=0} p && NF {print "    " $0}' "$conf"
  if grep -q '://localhost:\*' "$conf"; then
    echo "  cors_domains allows *://localhost:* -> a LAYR page on http://localhost:<port> can connect"
  else
    warn "cors_domains does not list *://localhost:*. LAYR served on another port will be rejected until you add it yourself."
  fi
  grep -Eq '^\s*127\.0\.0\.(0/8|1)' "$conf" || warn "trusted_clients may not include 127.0.0.1; LAYR on the Pi would need an API key."
else
  echo "  moonraker.conf not found in the usual locations"
fi

section "Ports"
for port in 7125 7180 8080; do
  if command -v ss >/dev/null && ss -ltn "sport = :$port" | grep -q LISTEN; then
    printf '  %s: in use\n' "$port"
  else
    printf '  %s: free\n' "$port"
  fi
done
echo
echo "Nothing was changed."
