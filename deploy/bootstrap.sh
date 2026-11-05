#!/usr/bin/env bash
# One-command LAYR install for a Raspberry Pi that already runs Klipper and Moonraker.
# The same command is the LAYR / KlipperScreen switcher on later runs.
# The printer may also already run AFC (including a Box Turtle) or Happy Hare, not both
# at once. Download this file, then run it. Do not pipe it into a shell.
#
#   curl -fsSL https://raw.githubusercontent.com/EzraTechnologies/LAYR/main/deploy/bootstrap.sh -o /tmp/layr-bootstrap.sh
#   bash /tmp/layr-bootstrap.sh
#
# This file is self-contained so that one download is enough. It does not source deploy/lib.sh.
# Nothing is installed, cloned, or switched until the preflight report succeeds.
# KlipperScreen stays up unless you confirm a separate display switch.
# Chromium is the browser. The optional WebKit port is not installed.
# AFC, Happy Hare, printer.cfg, moonraker.conf, and mmu.cfg are not installed or edited.
# AFC and Happy Hare are mutually exclusive in one LAYR printer profile. Test one at a
# time, or use a different printer. This script never starts both controllers.
# The Pi is not rebooted. HDMI modes are not written.
#
# First run (LAYR not installed): install packages and LAYR in preview, then ask
# before switching the display.
# Later runs: do not apt, download, build, or reinstall. Print the active display
# and a menu: Switch to LAYR, Switch to KlipperScreen, Update, Repair, Diagnostics,
# Exit, Uninstall LAYR. Exit, and a non-interactive run with no choice, change nothing.
# A successful install also adds a layr command on the printer user's PATH.
# After that, `layr` opens this same menu. It does not use /tmp or the network.
# Switching calls layr-display.sh. This file does not start or stop units itself.
# If both displays are active, neither is active, or systemd cannot be read, the
# status is printed and the display is not switched by itself.
# Switch to KlipperScreen still runs when LAYR is broken or the kiosk is down.
# It does not need the LAYR page or a network connection.
# Offline, from SSH, without downloading this file again:
#   layr to-klipperscreen --yes
#   ~/layr/src/deploy/layr-display.sh to-klipperscreen --yes
#
#   bash deploy/bootstrap.sh diagnose
#   bash deploy/bootstrap.sh --preflight
#   bash deploy/bootstrap.sh --dry-run --yes
#   bash deploy/bootstrap.sh --yes
#   bash deploy/bootstrap.sh --yes --switch-display
#   bash deploy/bootstrap.sh --switch-klipperscreen
#   bash deploy/bootstrap.sh --update
#   bash deploy/bootstrap.sh --repair
#   bash deploy/bootstrap.sh --status
#   bash deploy/bootstrap.sh --uninstall
#   LAYR_REF=<commit> bash deploy/bootstrap.sh
set -euo pipefail

NODE_VERSION="v22.23.4"
# Checksums from https://nodejs.org/dist/v22.23.4/SHASUMS256.txt
NODE_SHA_ARM64="f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9"
NODE_SHA_ARMV7="4318e0c68f62e18583dae85eb645f55c7f2b8a2e8d1fffe91a2e8abd046880ab"
GITHUB_REPO="EzraTechnologies/LAYR"

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWARNING:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

fail_preflight() {
  printf 'preflight=fail\n'
  printf 'changed=no\n'
  printf '%s\n' "$*"
  printf 'KlipperScreen was not stopped. No display rollback is required.\n'
  exit 1
}

print_recovery_bootstrap() {
  cat <<EOF

If the panel is blank or on the wrong screen, the Pi was not rebooted.
Run these as the printer user, not as root. KlipperScreen stays installed:

  ${HOME}/.local/bin/layr to-klipperscreen --yes
  ${HOME}/layr/src/deploy/layr-display.sh to-klipperscreen --yes
  ${HOME}/layr/src/deploy/rollback.sh --yes
  ${HOME}/layr/src/deploy/uninstall.sh
EOF
  if [ -n "${SCRIPT_DIR:-}" ] && [ -f "${SCRIPT_DIR}/layr-display.sh" ]; then
    cat <<EOF

From this checkout the same commands are:

  ${SCRIPT_DIR}/layr-display.sh to-klipperscreen --yes
  ${SCRIPT_DIR}/rollback.sh --yes
  ${SCRIPT_DIR}/uninstall.sh
EOF
  fi
  cat <<'EOF'

Those commands do not edit printer.cfg, moonraker.conf, mmu.cfg, or AFC / Box Turtle files.
EOF
  print_offline_fallback
}

# Printed on its own so a later run can show it without downloading this file again.
print_offline_fallback() {
  local root script
  root=$(layr_root)
  script="${root}/src/deploy/layr-display.sh"
  printf 'offline-fallback: %s to-klipperscreen --yes\n' "$(layr_command_path)"
  printf 'offline-fallback-script: %s to-klipperscreen --yes\n' "$script"
  printf 'offline-fallback-needs-download: no\n'
  printf 'After the layr command is installed, run: layr to-klipperscreen --yes\n'
  printf 'That command does not download the installer, and it does not need GitHub or the LAYR page.\n'
  printf 'The same switch is also on disk as: %s to-klipperscreen --yes\n' "$script"
  printf 'A text console is Ctrl+Alt+F1, or: sudo chvt 1\n'
}

layr_root() {
  printf '%s\n' "${LAYR_HOME_OVERRIDE:-${LAYR_HOME:-$HOME/layr}}"
}

require_complete_script() {
  local file="$1"
  local marker="# LAYR_SCRIPT_END"
  local last=""
  [ -f "$file" ] || die "Refusing to run $file: the file is missing. Nothing was changed."
  last=$(awk 'NF { line = $0 } END { print line }' "$file")
  if [ "$last" != "$marker" ]; then
    die "Refusing to run an incomplete copy of $file. Download it again. Nothing was changed."
  fi
}

have_item() {
  local name="$1"
  if [ -n "${LAYR_FAKE_PRESENT+x}" ]; then
    case " ${LAYR_FAKE_PRESENT} " in
      *" ${name} "*) return 0 ;;
      *) return 1 ;;
    esac
  fi
  if command -v "$name" >/dev/null 2>&1; then
    return 0
  fi
  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f '${Status}' "$name" 2>/dev/null | grep -q 'install ok installed'
    return
  fi
  return 1
}

apt_has() {
  local name="$1"
  local list
  if [ -n "${LAYR_FAKE_PRESENT+x}" ] || [ -n "${LAYR_APT_HAS+x}" ]; then
    list="${LAYR_APT_HAS-chromium cage git curl ca-certificates python3 tar gzip coreutils}"
    case " ${list} " in
      *" ${name} "*) return 0 ;;
      *) return 1 ;;
    esac
  fi
  apt-cache show "$name" >/dev/null 2>&1
}

chromium_package_name() {
  if apt_has chromium; then
    printf 'chromium\n'
  elif apt_has chromium-browser; then
    printf 'chromium-browser\n'
  else
    printf 'chromium\n'
  fi
}

sudo_ok() {
  case "${LAYR_SUDO_OK:-auto}" in
    1 | yes | true) return 0 ;;
    0 | no | false) return 1 ;;
  esac
  sudo -n true 2>/dev/null
}

run_root() {
  if [ "${DRY_RUN:-0}" = 1 ]; then
    printf '   [dry-run] sudo'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  if [ -n "${LAYR_SUDO_CMD:-}" ]; then
    "$LAYR_SUDO_CMD" "$@"
    return
  fi
  sudo --preserve-env=DEBIAN_FRONTEND,NEEDRESTART_MODE "$@"
}

group_line() {
  if [ -n "${LAYR_GROUPS+x}" ]; then
    printf '%s\n' "$LAYR_GROUPS"
    return 0
  fi
  id -nG
}

mem_mb() {
  if [ -n "${LAYR_MEM_MB:-}" ]; then
    printf '%s\n' "$LAYR_MEM_MB"
    return 0
  fi
  awk '/MemTotal/ { print int($2 / 1024); exit }' /proc/meminfo
}

disk_free_mb() {
  if [ -n "${LAYR_DISK_FREE_MB:-}" ]; then
    printf '%s\n' "$LAYR_DISK_FREE_MB"
    return 0
  fi
  df -Pm "${HOME}" | awk 'NR == 2 { print $4; exit }'
}

os_field() {
  local file="$1"
  local key="$2"
  local line
  line=$(sed -n "s/^${key}=//p" "$file" | tail -n 1 || true)
  line=${line#\"}
  line=${line%\"}
  printf '%s\n' "$line"
}

detect_platform() {
  local file="${LAYR_OS_RELEASE:-/etc/os-release}"
  local arch="${LAYR_ARCH:-$(uname -m)}"
  local model_file="${LAYR_DEVICE_TREE-/proc/device-tree/model}"
  local rpi_file="${LAYR_RPI_ISSUE-/etc/rpi-issue}"
  local id="" codename="" version_id="" pretty="" name="" id_like=""
  local looks_pi=0 debian_family=0 bookworm=0 arch_ok=0
  local mainsail_files kind="" model=""
  PLATFORM_SUPPORT=no
  PLATFORM_KIND=""
  PLATFORM_REASON=""
  PLATFORM_ARCH="$arch"
  PLATFORM_PRETTY=""
  PLATFORM_MODEL=""
  if [ ! -r "$file" ]; then
    PLATFORM_REASON="Cannot read $file. Nothing was changed."
    return 0
  fi
  id=$(os_field "$file" ID)
  codename=$(os_field "$file" VERSION_CODENAME)
  version_id=$(os_field "$file" VERSION_ID)
  pretty=$(os_field "$file" PRETTY_NAME)
  name=$(os_field "$file" NAME)
  id_like=$(os_field "$file" ID_LIKE)
  PLATFORM_PRETTY="$pretty"
  case "$id" in
    debian | raspbian | mainsailos) debian_family=1 ;;
  esac
  case "$id_like" in
    *debian*) debian_family=1 ;;
  esac
  if [ "$codename" = "bookworm" ] || [ "$version_id" = "12" ]; then
    bookworm=1
  fi
  case "$arch" in
    aarch64 | arm64)
      arch=aarch64
      arch_ok=1
      ;;
    armv7l | armhf)
      arch=armv7l
      arch_ok=1
      ;;
  esac
  PLATFORM_ARCH="$arch"
  case "$id" in
    raspbian)
      looks_pi=1
      kind="raspberry-pi-os"
      ;;
    mainsailos)
      looks_pi=1
      kind="mainsailos"
      ;;
  esac
  local pretty_lc
  pretty_lc=$(printf '%s %s' "$pretty" "$name" | tr '[:upper:]' '[:lower:]')
  case "$pretty_lc" in
    *mainsail*)
      looks_pi=1
      kind="mainsailos"
      ;;
    *raspberry\ pi* | *raspbian*)
      looks_pi=1
      if [ -z "$kind" ]; then
        kind="raspberry-pi-os"
      fi
      ;;
  esac
  if [ -r "$model_file" ] && tr -d '\0' <"$model_file" | grep -qi 'raspberry pi'; then
    looks_pi=1
    model=$(tr -d '\0' <"$model_file")
    if [ -z "$kind" ]; then
      kind="raspberry-pi-os"
    fi
  fi
  if [ -r "$rpi_file" ]; then
    looks_pi=1
    if [ -z "$kind" ]; then
      kind="raspberry-pi-os"
    fi
  fi
  if [ -n "${LAYR_MAINSAIL_FILES+x}" ]; then
    mainsail_files=$LAYR_MAINSAIL_FILES
  else
    mainsail_files="/etc/mainsailos-release /etc/mainsail-release"
  fi
  local extra
  for extra in $mainsail_files; do
    if [ -n "$extra" ] && [ -r "$extra" ]; then
      looks_pi=1
      kind="mainsailos"
      break
    fi
  done
  PLATFORM_KIND=$kind
  PLATFORM_MODEL=$model
  if [ "$debian_family" != 1 ]; then
    PLATFORM_REASON="This OS (${pretty:-unknown}) is not supported. Use Raspberry Pi OS Bookworm or MainsailOS Bookworm. Nothing was changed."
    return 0
  fi
  if [ "$bookworm" != 1 ]; then
    PLATFORM_REASON="This release (${codename:-unknown}) is not supported. Bookworm (Debian 12) is the supported release. Nothing was changed."
    return 0
  fi
  if [ "$arch_ok" != 1 ]; then
    PLATFORM_REASON="Architecture ${PLATFORM_ARCH} is not supported. arm64 and armhf (armv7) only. armv6 and PCs are not supported. Nothing was changed."
    return 0
  fi
  if [ "$looks_pi" != 1 ]; then
    PLATFORM_REASON="This looks like Debian Bookworm but not Raspberry Pi OS or MainsailOS. Nothing was changed."
    return 0
  fi
  PLATFORM_SUPPORT=yes
  PLATFORM_REASON="Supported ${kind} ${arch}."
}

url_allowed() {
  local url="$1"
  case "$url" in
    *@* | *[[:space:]]* | *..* | *\\*) return 1 ;;
  esac
  case "$url" in
    https://github.com/"${GITHUB_REPO}"/releases/download/*/layr-dist.tar.gz) return 0 ;;
    https://github.com/"${GITHUB_REPO}"/releases/download/*/layr-dist.tar.gz.sha256) return 0 ;;
    https://api.github.com/repos/"${GITHUB_REPO}"/*) return 0 ;;
    https://nodejs.org/dist/"${NODE_VERSION}"/node-"${NODE_VERSION}"-linux-arm64.tar.gz) return 0 ;;
    https://nodejs.org/dist/"${NODE_VERSION}"/node-"${NODE_VERSION}"-linux-armv7l.tar.gz) return 0 ;;
    https://objects.githubusercontent.com/*) return 0 ;;
    https://release-assets.githubusercontent.com/*) return 0 ;;
    https://github-releases.githubusercontent.com/*) return 0 ;;
    *) return 1 ;;
  esac
}

node_spec() {
  local arch="$1"
  case "$arch" in
    aarch64)
      printf '%s\n%s\n' "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-arm64.tar.gz" "$NODE_SHA_ARM64"
      ;;
    armv7l)
      printf '%s\n%s\n' "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-armv7l.tar.gz" "$NODE_SHA_ARMV7"
      ;;
    *)
      return 1
      ;;
  esac
}

node_version_ok() {
  local bin="$1"
  local raw major minor
  raw=$("$bin" -v 2>/dev/null || true)
  raw=${raw#v}
  major=${raw%%.*}
  minor=${raw#*.}
  minor=${minor%%.*}
  case "$major" in
    '' | *[!0-9]*) return 1 ;;
  esac
  case "$minor" in
    '' | *[!0-9]*) return 1 ;;
  esac
  if [ "$major" -gt 22 ]; then
    return 0
  fi
  [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]
}

is_full_sha() {
  local ref="${1,,}"
  [[ "$ref" =~ ^[0-9a-f]{40}$ ]]
}

# Loopback probes and the Moonraker URL the user named are the only plain HTTP
# destinations. Everything else has to be an allowlisted HTTPS download.
probe_url_allowed() {
  local url="$1"
  local base ipv6
  case "$url" in
    http://127.0.0.1:* | http://127.0.0.1/* | http://localhost:* | http://localhost/*)
      return 0
      ;;
  esac
  ipv6="http://[::1]"
  if [[ "$url" == "$ipv6":* || "$url" == "$ipv6"/* ]]; then
    return 0
  fi
  if [ -z "${MOONRAKER:-}" ]; then
    return 1
  fi
  base="${MOONRAKER%/}"
  validate_moonraker_url "$base" || return 1
  case "$url" in
    "$base"/server/info | "$base"/printer/objects/list | "$base"/printer/objects/query | "$base"/printer/objects/query\?*)
      return 0
      ;;
  esac
  return 1
}

http_get() {
  local url="$1"
  local dest="$2"
  local limit="${3:-80000000}"
  if [ -n "${LAYR_HTTP_LOG:-}" ]; then
    printf '%s\n' "$url" >>"$LAYR_HTTP_LOG"
  fi
  if [ -n "${LAYR_HTTP_GET:-}" ]; then
    "$LAYR_HTTP_GET" "$url" "$dest"
    return
  fi
  if probe_url_allowed "$url"; then
    case "$url" in
      https://*)
        curl -fsSL --proto '=https' --tlsv1.2 --retry 2 --retry-delay 1 --max-time 20 --max-filesize "$limit" -o "$dest" "$url"
        ;;
      http://*)
        curl -fsS --proto '=http' --max-time 8 --max-filesize "$limit" -o "$dest" "$url"
        ;;
      *)
        return 1
        ;;
    esac
    return
  fi
  url_allowed "$url" || die "Refusing download URL that is not on the LAYR list."
  case "$url" in
    https://*)
      curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 --max-time 180 --max-filesize "$limit" -o "$dest" "$url"
      ;;
    *)
      return 1
      ;;
  esac
}

parse_release_json() {
  python3 - "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
dist = ""
sha = ""
for asset in data.get("assets") or []:
    if not isinstance(asset, dict):
        continue
    name = asset.get("name") or ""
    url = asset.get("browser_download_url") or ""
    if name == "layr-dist.tar.gz":
        dist = url
    elif name == "layr-dist.tar.gz.sha256":
        sha = url
tag = data.get("tag_name") or ""
sys.stdout.write(tag + "\n" + dist + "\n" + sha + "\n")
PY
}

read_sha_token() {
  local file="$1"
  local word
  word=$(awk 'NF { print $1; exit }' "$file")
  if [[ "$word" =~ ^[0-9a-f]{64}$ ]]; then
    printf '%s\n' "$word"
    return 0
  fi
  return 1
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local got
  got=$(sha256sum "$file" | awk '{ print $1 }')
  [ "$got" = "$expected" ]
}

report_display() {
  local root="${LAYR_DRM_ROOT-/sys/class/drm}"
  local status dir mode found=0
  printf 'resolution: auto\n'
  printf 'hdmi-mode: not set\n'
  printf 'boot-config: not written\n'
  shopt -s nullglob
  for status in "$root"/card*-*/status; do
    [ -f "$status" ] || continue
    found=1
    dir=$(dirname "$status")
    printf 'connector: %s %s\n' "$(basename "$dir")" "$(tr -d '\n' <"$status")"
    if [ "$(tr -d '\n' <"$status")" = "connected" ] && [ -r "$dir/modes" ]; then
      mode=$(awk 'NF { print; exit }' "$dir/modes")
      printf 'preferred: %s\n' "$mode"
      printf 'modes: %s\n' "$(tr '\n' ' ' <"$dir/modes")"
      if grep -q '800x480' "$dir/modes"; then
        printf 'panel-800x480: listed\n'
        printf 'note: 800x480 is available and was not forced. Cage uses the preferred mode.\n'
      fi
    fi
  done
  shopt -u nullglob
  if [ "$found" = 0 ]; then
    printf 'connector: none\n'
    printf 'note: no display mode was written. The panel keeps the mode it already has.\n'
  fi
}

report_touch() {
  local file="${LAYR_INPUT_DEVICES-/proc/bus/input/devices}"
  local saw=0
  printf 'udev: not modified\n'
  if [ ! -r "$file" ]; then
    printf 'touch: unreadable\n'
    return 0
  fi
  awk '
    function emit() {
      if (name == "") return
      printf "input: %s handlers=%s\n", name, handlers
      if (name ~ /[Tt]ouch|Goodix|goodix|[Ff][Tt]5|eGalax|egalax|ADS7846|hid-multitouch|ft5406/)
        printf "touch: %s\n", name
      name = ""
      handlers = ""
    }
    /^N: Name=/ {
      emit()
      name = $0
      sub(/^N: Name=/, "", name)
      gsub(/^"|"$/, "", name)
    }
    /^H: Handlers=/ {
      handlers = $0
      sub(/^H: Handlers=/, "", handlers)
    }
    END { emit() }
  ' "$file"
  if awk '
      /^N: Name=/ {
        name = $0
        sub(/^N: Name=/, "", name)
        gsub(/^"|"$/, "", name)
        if (name ~ /[Tt]ouch|Goodix|goodix|[Ff][Tt]5|eGalax|egalax|ADS7846|hid-multitouch|ft5406/) found = 1
      }
      END { exit(found ? 0 : 1) }
    ' "$file"; then
    saw=1
  fi
  if [ "$saw" != 1 ]; then
    printf 'touch: none listed\n'
  fi
  if [ -n "${LAYR_TOUCH_SAMPLE_RESULT:-}" ]; then
    printf 'touch-events: %s\n' "$LAYR_TOUCH_SAMPLE_RESULT"
  elif [ "${SAMPLE_TOUCH:-0}" = 1 ]; then
    sample_touch_events "$file"
  else
    printf 'touch-events: not sampled\n'
  fi
  printf 'note: mice and touchscreens are left enabled. No input rule was written.\n'
}

# Read-only. Opens one touch event node for up to five seconds. Writes no udev rule.
sample_touch_events() {
  local file="$1"
  local node event root
  event=$(awk '
    /^N: Name=/ {
      name = $0
      sub(/^N: Name=/, "", name)
      gsub(/^"|"$/, "", name)
    }
    /^H: Handlers=/ {
      if (name ~ /[Tt]ouch|Goodix|goodix|[Ff][Tt]5|eGalax|egalax|ADS7846|hid-multitouch|ft5406/ && match($0, /event[0-9]+/)) {
        print substr($0, RSTART, RLENGTH)
        exit
      }
    }
  ' "$file")
  if [ -z "$event" ]; then
    printf 'touch-events: no touch device to sample\n'
    return 0
  fi
  root="${LAYR_INPUT_ROOT:-/dev/input}"
  node="${root}/${event}"
  if [ ! -r "$node" ]; then
    printf 'touch-events: %s is not readable. The input group may be missing. No udev rule was written.\n' "$node"
    return 0
  fi
  if ! have_item python3; then
    printf 'touch-events: python3 is not installed yet, so no tap was read\n'
    return 0
  fi
  python3 - "$node" <<'PY' || printf 'touch-events: sample failed\n'
import os, select, struct, sys, time
path = sys.argv[1]
try:
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
except OSError as exc:
    print("touch-events: unreadable (%s)" % exc.strerror)
    raise SystemExit(0)
size = struct.calcsize("llHHi")
deadline = time.time() + 5
count = 0
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if not ready:
        continue
    data = os.read(fd, size * 32)
    if not data:
        break
    count += max(1, len(data) // size)
print("touch-events: events=%s" % count)
PY
}

controller_word() {
  local afc="${AFC_STATE:-unknown}"
  local mmu="${MMU_STATE:-unknown}"
  if [ "$afc" = "unknown" ] || [ "$mmu" = "unknown" ]; then
    printf 'unknown\n'
  elif [ "$afc" = "present" ] && [ "$mmu" = "present" ]; then
    printf 'both\n'
  elif [ "$afc" = "present" ]; then
    printf 'afc\n'
  elif [ "$mmu" = "present" ]; then
    printf 'happy-hare\n'
  else
    printf 'neither\n'
  fi
}

print_controller_facts() {
  printf 'afc-object: %s\n' "${AFC_STATE:-unknown}"
  printf 'mmu-object: %s\n' "${MMU_STATE:-unknown}"
  printf 'afc-lanes: not checked\n'
  printf 'afc-unit: not checked\n'
}

# Read-only. Object names come from printer/objects/list. Status, when printed,
# comes from one GET printer/objects/query. No G-code is sent.
probe_moonraker() {
  local base="${MOONRAKER%/}"
  local body report query status_file checked
  body=$(mktemp)
  MOONRAKER_REACHABLE=no
  AFC_STATE=unknown
  MMU_STATE=unknown
  checked=0
  if ! have_item curl && [ -z "${LAYR_HTTP_GET:-}" ]; then
    printf 'moonraker: not checked yet\n'
  elif http_get "${base}/server/info" "$body" 2000000; then
    MOONRAKER_REACHABLE=yes
    printf 'moonraker: reachable: yes\n'
    if have_item python3; then
      python3 - "$body" <<'PY' || true
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
result = data.get("result") or data
print("klippy_state=%s moonraker=%s" % (result.get("klippy_state"), result.get("moonraker_version")))
PY
    fi
  else
    printf 'moonraker: reachable: no\n'
    printf 'warning: Moonraker did not answer at %s. The installer will not edit moonraker.conf.\n' "$base"
  fi
  if [ "$MOONRAKER_REACHABLE" = "yes" ] && have_item python3 && http_get "${base}/printer/objects/list" "$body" 2000000; then
    report=$(python3 - "$body" <<'PY'
import json, sys
LANE_PREFIXES = ("AFC_lane ", "AFC_stepper ")
UNIT_PREFIXES = (
    "AFC_BoxTurtle ",
    "AFC_NightOwl ",
    "AFC_HTLF ",
    "AFC_QuattroBox ",
    "AFC_Claymore ",
    "AFC_EMU ",
    "AFC_OAMS ",
    "AFC_OpenAMS ",
    "AFC_Toolchanger ",
    "AFC_vivid ",
)

def main():
    try:
        with open(sys.argv[1], encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        print("afc-object: unknown")
        print("mmu-object: unknown")
        print("afc-lanes: not checked")
        print("afc-unit: not checked")
        return
    objects = (data.get("result") or {}).get("objects")
    if objects is None and isinstance(data.get("objects"), list):
        objects = data.get("objects")
    if not isinstance(objects, list):
        print("afc-object: unknown")
        print("mmu-object: unknown")
        print("afc-lanes: not checked")
        print("afc-unit: not checked")
        return
    names = [item for item in objects if isinstance(item, str)]
    afc = any(name == "AFC" or name.startswith("AFC_") for name in names)
    mmu = any(name == "mmu" for name in names)
    lanes = []
    for name in names:
        for prefix in LANE_PREFIXES:
            if name.startswith(prefix):
                lane = name[len(prefix):]
                if lane and len(lane) <= 32 and all(c.isalnum() or c in "_-" for c in lane):
                    lanes.append(lane)
                break
        if len(lanes) >= 32:
            break
    units = []
    for name in names:
        if any(name.startswith(prefix) for prefix in UNIT_PREFIXES):
            units.append(" ".join(name.split()))
        if len(units) >= 8:
            break
    print("afc-object: " + ("present" if afc else "absent"))
    print("mmu-object: " + ("present" if mmu else "absent"))
    print("afc-lanes: " + (" ".join(lanes) if lanes else "none"))
    if units:
        for unit in units:
            print("afc-unit: " + unit)
    else:
        print("afc-unit: none")

main()
PY
)
    if printf '%s\n' "$report" | grep -q '^afc-object: '; then
      printf '%s\n' "$report"
      AFC_STATE=$(printf '%s\n' "$report" | sed -n 's/^afc-object: //p' | head -n 1)
      MMU_STATE=$(printf '%s\n' "$report" | sed -n 's/^mmu-object: //p' | head -n 1)
      [ -n "$AFC_STATE" ] || AFC_STATE=unknown
      [ -n "$MMU_STATE" ] || MMU_STATE=unknown
      checked=1
    fi
  fi
  if [ "$checked" = 1 ] && { [ "$AFC_STATE" = "present" ] || [ "$MMU_STATE" = "present" ]; }; then
    query=$(python3 - "$body" <<'PY'
import json, sys, urllib.parse
LANE_PREFIXES = ("AFC_lane ", "AFC_stepper ")
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
except (OSError, json.JSONDecodeError):
    raise SystemExit(0)
objects = (data.get("result") or {}).get("objects")
if objects is None and isinstance(data.get("objects"), list):
    objects = data.get("objects")
names = [item for item in objects if isinstance(item, str)] if isinstance(objects, list) else []
pairs = []
if "AFC" in names:
    pairs.append(("AFC", "current_load,current_lane,current_state,error_state,message,lanes"))
lane_count = 0
for name in names:
    if any(name.startswith(prefix) for prefix in LANE_PREFIXES):
        pairs.append((name, "filament_status,prep,load,tool_loaded,loaded_to_hub"))
        lane_count += 1
        if lane_count >= 16:
            break
if "mmu" in names:
    pairs.append(("mmu", "tool,gate,filament,action,print_state,enabled,reason_for_pause,gate_status,gate_material,gate_filament_name"))
if pairs:
    print("/printer/objects/query?" + urllib.parse.urlencode(pairs))
PY
)
    status_file=$(mktemp)
    if [ -n "$query" ] && http_get "${base}${query}" "$status_file" 2000000; then
      python3 - "$status_file" "$AFC_STATE" "$MMU_STATE" <<'PY'
import json, sys

def cell(value):
    if value is None:
        return "not-reported"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float):
            return str(int(value)) if value.is_integer() else str(value)
        return str(value)
    if isinstance(value, str):
        text = " ".join(value.split())
        return text[:80] if text else "empty"
    return "not-reported"

def pick(obj, key):
    if not isinstance(obj, dict) or key not in obj:
        return "not-reported"
    return cell(obj.get(key))

def as_list(value):
    return value if isinstance(value, list) else []

afc_state = sys.argv[2]
mmu_state = sys.argv[3]
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
except (OSError, json.JSONDecodeError):
    if afc_state == "present":
        print("afc-status: not read")
    if mmu_state == "present":
        print("mmu-status: not read")
    raise SystemExit(0)
status = (data.get("result") or {}).get("status")
if not isinstance(status, dict):
    status = data.get("status") if isinstance(data.get("status"), dict) else {}
if afc_state == "present":
    afc = status.get("AFC") if isinstance(status.get("AFC"), dict) else {}
    print(
        "afc-status: current_load=%s current_lane=%s current_state=%s error_state=%s message=%s"
        % (pick(afc, "current_load"), pick(afc, "current_lane"), pick(afc, "current_state"), pick(afc, "error_state"), pick(afc, "message"))
    )
    shown = 0
    for name, lane in status.items():
        if not isinstance(name, str) or not isinstance(lane, dict):
            continue
        lane_name = ""
        for prefix in ("AFC_lane ", "AFC_stepper "):
            if name.startswith(prefix):
                lane_name = name[len(prefix):]
                break
        if not lane_name:
            continue
        print(
            "afc-lane-status: %s filament_status=%s prep=%s load=%s tool_loaded=%s loaded_to_hub=%s"
            % (lane_name, pick(lane, "filament_status"), pick(lane, "prep"), pick(lane, "load"), pick(lane, "tool_loaded"), pick(lane, "loaded_to_hub"))
        )
        shown += 1
        if shown >= 16:
            break
if mmu_state == "present":
    mmu = status.get("mmu") if isinstance(status.get("mmu"), dict) else {}
    print(
        "mmu-status: tool=%s gate=%s filament=%s action=%s print_state=%s enabled=%s reason_for_pause=%s"
        % (pick(mmu, "tool"), pick(mmu, "gate"), pick(mmu, "filament"), pick(mmu, "action"), pick(mmu, "print_state"), pick(mmu, "enabled"), pick(mmu, "reason_for_pause"))
    )
    gates = as_list(mmu.get("gate_status"))
    materials = as_list(mmu.get("gate_material"))
    names = as_list(mmu.get("gate_filament_name"))
    count = min(16, max(len(gates), len(materials), len(names)))
    for index in range(count):
        gate_status = cell(gates[index]) if index < len(gates) else "not-reported"
        material = cell(materials[index]) if index < len(materials) else "not-reported"
        gate_name = cell(names[index]) if index < len(names) else "not-reported"
        print("mmu-gate: %s status=%s material=%s name=%s" % (index, gate_status, material, gate_name))
PY
    else
      if [ "$AFC_STATE" = "present" ]; then
        printf 'afc-status: not read\n'
      fi
      if [ "$MMU_STATE" = "present" ]; then
        printf 'mmu-status: not read\n'
      fi
    fi
    rm -f "$status_file"
  elif [ "$checked" != 1 ]; then
    print_controller_facts
  fi
  rm -f "$body"
  printf 'controllers: %s\n' "$(controller_word)"
}

print_controller_guidance() {
  printf 'panel-check: On the 5-inch panel, confirm every button is reachable before a filament move. The installer does not force 800x480.\n'
  case "$(controller_word)" in
    both)
      cat <<'EOF'
controller-guidance: AFC and Happy Hare objects were both listed. This installer did not install, configure, or start either one.
controller-guidance: They are mutually exclusive inside one LAYR printer profile. Turn on only the controller this printer uses. Leave the other switch off.
controller-guidance: Do not enable both switches. Do not run both controllers at the same time.
controller-guidance: Test the other system later on this printer, after the first switch is off, or on a different printer. LAYR does not need to be reinstalled.
controller-guidance: Load, unload, lane or tool change, and recovery each ask before anything moves. Cancel sends nothing. Do that only while the printer is idle.
EOF
      ;;
    afc)
      cat <<'EOF'
controller-guidance: An AFC object was listed (read only). LAYR did not install or change AFC or the Box Turtle.
controller-guidance: No Happy Hare mmu object was listed. Leave Happy Hare off.
controller-guidance: In LAYR, open Settings, then Integrations, and turn AFC on for this printer. Leave Happy Hare off. Both can stay off.
controller-guidance: Lane load, change, and unload ask before anything moves. Cancel sends nothing. Do that only when the printer is idle.
EOF
      ;;
    happy-hare)
      cat <<'EOF'
controller-guidance: A Happy Hare mmu object was listed (read only). LAYR did not install or change Happy Hare.
controller-guidance: No AFC object was listed. Leave AFC off.
controller-guidance: In LAYR, open Settings, then Integrations, and turn Happy Hare on for this printer. Leave AFC off. Both can stay off.
controller-guidance: Load, unload, tool change, and recovery ask before anything moves. Cancel sends nothing. Do that only when the printer is idle.
EOF
      ;;
    neither)
      cat <<'EOF'
controller-guidance: No AFC object and no Happy Hare mmu object were listed. Both stay off. That is fine for a printer without either system.
controller-guidance: LAYR did not install AFC, Happy Hare, or a Box Turtle config.
controller-guidance: You can test one later on this printer, or on a different printer, without reinstalling LAYR. Do not enable both switches in the same printer profile.
EOF
      ;;
    *)
      cat <<'EOF'
controller-guidance: AFC and Happy Hare were not checked. Both switches stay off until you turn one on. Nothing was installed.
controller-guidance: Turn on only one of them per printer profile. Test the other at a different time, or on a different printer. Do not enable both switches.
EOF
      ;;
  esac
}

warn_moonraker_conf() {
  local conf="" candidate
  if [ -n "${LAYR_MOONRAKER_CONF+x}" ]; then
    if [ -n "$LAYR_MOONRAKER_CONF" ] && [ -r "$LAYR_MOONRAKER_CONF" ]; then
      conf=$LAYR_MOONRAKER_CONF
    fi
  else
    for candidate in "$HOME/printer_data/config/moonraker.conf" "$HOME/klipper_config/moonraker.conf"; do
      if [ -r "$candidate" ]; then
        conf=$candidate
        break
      fi
    done
  fi
  if [ -z "$conf" ]; then
    printf 'moonraker-conf: not found (not created)\n'
    return 0
  fi
  printf 'moonraker-conf: read only %s\n' "$conf"
  if grep -q '://localhost:\*' "$conf"; then
    printf 'cors: localhost wildcard is present\n'
  else
    printf 'warning: cors_domains does not list *://localhost:*. Add that yourself if the browser rejects LAYR. This file was not edited.\n'
  fi
}

report_services() {
  local unit state
  if ! command -v systemctl >/dev/null 2>&1; then
    printf 'services: systemctl not available\n'
    return 0
  fi
  for unit in KlipperScreen.service layr-web.service layr-kiosk.service moonraker.service klipper.service; do
    state=$(systemctl is-active "$unit" 2>/dev/null || true)
    printf 'service: %s %s\n' "$unit" "${state:-unknown}"
  done
}

validate_moonraker_url() {
  local url="$1"
  case "$url" in
    http://* | https://*) ;;
    *) return 1 ;;
  esac
  case "$url" in
    *@* | *[[:space:]]* | *'`'* | *'$('* | *\\*) return 1 ;;
  esac
  return 0
}

lookup_release() {
  local body tag dist sha
  body=$(mktemp)
  SOURCE_TAG=""
  RELEASE_URL=""
  RELEASE_SHA_URL=""
  if ! http_get "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" "$body" 2000000; then
    if [ -s "$body" ] && grep -q 'Not Found' "$body"; then
      rm -f "$body"
      return 1
    fi
    rm -f "$body"
    return 2
  fi
  if ! have_item python3; then
    rm -f "$body"
    return 1
  fi
  if ! parsed=$(parse_release_json "$body"); then
    rm -f "$body"
    return 1
  fi
  rm -f "$body"
  tag=$(printf '%s\n' "$parsed" | sed -n '1p')
  dist=$(printf '%s\n' "$parsed" | sed -n '2p')
  sha=$(printf '%s\n' "$parsed" | sed -n '3p')
  if [ -z "$dist" ] || [ -z "$sha" ]; then
    if [ -n "$dist" ]; then
      printf 'warning: unsigned release was ignored\n'
    fi
    return 1
  fi
  url_allowed "$dist" || return 1
  url_allowed "$sha" || return 1
  case "$tag" in
    v[A-Za-z0-9._-]*) ;;
    *) return 1 ;;
  esac
  SOURCE_TAG=$tag
  RELEASE_URL=$dist
  RELEASE_SHA_URL=$sha
  return 0
}

resolve_ref() {
  local ref="$1"
  local body sha encoded
  if is_full_sha "$ref"; then
    printf '%s\n' "${ref,,}"
    return 0
  fi
  encoded=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$ref")
  body=$(mktemp)
  if ! http_get "https://api.github.com/repos/${GITHUB_REPO}/commits/${encoded}" "$body" 2000000; then
    rm -f "$body"
    return 1
  fi
  sha=$(python3 - "$body" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
sha = data.get("sha") or ""
if len(sha) == 40 and all(c in "0123456789abcdef" for c in sha):
    print(sha)
else:
    raise SystemExit(1)
PY
)
  rm -f "$body"
  printf '%s\n' "$sha"
}

choose_source() {
  local lookup=0
  SOURCE_TAG=""
  RELEASE_URL=""
  RELEASE_SHA_URL=""
  SOURCE_SHA=""
  if [ -n "${DIST_ARG:-}" ]; then
    SOURCE_MODE=dist
    return 0
  fi
  if [ "${REF_EXPLICIT:-0}" = 1 ] && is_full_sha "$REF"; then
    SOURCE_MODE=build
    SOURCE_SHA="${REF,,}"
    return 0
  fi
  if ! have_item python3 || { ! have_item curl && [ -z "${LAYR_HTTP_GET:-}" ]; }; then
    SOURCE_MODE=deferred
    return 0
  fi
  if [ "${REF_EXPLICIT:-0}" = 1 ]; then
    SOURCE_SHA=$(resolve_ref "$REF") || return 1
    SOURCE_MODE=build
    return 0
  fi
  lookup_release && lookup=$? || lookup=$?
  if [ "$lookup" -eq 0 ]; then
    SOURCE_MODE=release
    return 0
  fi
  if [ "$lookup" -eq 2 ]; then
    return 1
  fi
  SOURCE_SHA=$(resolve_ref "$REF") || return 1
  SOURCE_MODE=build
  return 0
}

need_disk_mb() {
  case "${SOURCE_MODE:-build}" in
    dist | release) printf '400\n' ;;
    *) printf '1536\n' ;;
  esac
}

need_mem_mb() {
  case "${SOURCE_MODE:-build}" in
    dist | release) printf '256\n' ;;
    *) printf '512\n' ;;
  esac
}

scripts_are_local() {
  [ -f "${SCRIPT_DIR}/install.sh" ] && [ -f "${SCRIPT_DIR}/layr-display.sh" ] && [ -f "${SCRIPT_DIR}/lib.sh" ]
}

plan_packages() {
  PACKAGES=()
  have_item ca-certificates || PACKAGES+=(ca-certificates)
  have_item curl || PACKAGES+=(curl)
  have_item python3 || PACKAGES+=(python3)
  if [ "${NEED_CLONE:-0}" = 1 ]; then
    have_item git || PACKAGES+=(git)
  fi
  have_item tar || PACKAGES+=(tar)
  have_item gzip || PACKAGES+=(gzip)
  if ! have_item sha256sum && [ "${SOURCE_MODE:-build}" != "dist" ]; then
    PACKAGES+=(coreutils)
  fi
  have_item cage || PACKAGES+=(cage)
  if ! have_item chromium && ! have_item chromium-browser; then
    PACKAGES+=("$(chromium_package_name)")
  fi
}

print_scope() {
  cat <<'EOF'
supported: Raspberry Pi OS Bookworm and MainsailOS Bookworm, arm64 or armhf, Chromium, with Klipper and Moonraker already installed.
not-supported: Ubuntu and other Debian releases, armv6, installing AFC, Happy Hare, or Box Turtle, running both filament controllers at once, the optional WebKit port, forced HDMI modes, reboots, and edits to printer.cfg, moonraker.conf, or mmu.cfg.
EOF
}

print_source_line() {
  local spec url sha
  case "$SOURCE_MODE" in
    release)
      printf 'source: release %s\n' "$SOURCE_TAG"
      printf 'source-url: %s\n' "$RELEASE_URL"
      printf 'source-sha256-url: %s\n' "$RELEASE_SHA_URL"
      ;;
    build)
      printf 'source: build %s\n' "${SOURCE_SHA:-unresolved}"
      if spec=$(node_spec "$PLATFORM_ARCH"); then
        url=$(printf '%s\n' "$spec" | sed -n '1p')
        sha=$(printf '%s\n' "$spec" | sed -n '2p')
        printf 'node-url: %s\n' "$url"
        printf 'node-sha256: %s\n' "$sha"
      fi
      printf 'build: npm ci && npm run build\n'
      ;;
    dist)
      printf 'source: dist %s\n' "$DIST_PATH"
      ;;
    deferred)
      printf 'source: deferred\n'
      printf 'note: curl and python3 are installed first, then a release asset is preferred over building.\n'
      ;;
  esac
  printf 'browser: chromium\n'
  printf 'webkit-port: not installed\n'
  printf 'apt-restarts: disabled\n'
}

confirm_answer() {
  local reply
  if [ "${ASSUME_YES:-0}" = 1 ] || [ "${DRY_RUN:-0}" = 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    die "No terminal for a question. Re-run in SSH without piping, or pass --yes to install in preview mode. --yes does not switch off KlipperScreen."
  fi
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

systemctl_bin() {
  if [ "${LAYR_SYSTEMCTL_BIN:-}" = "missing" ]; then
    return 1
  fi
  if [ -n "${LAYR_SYSTEMCTL_BIN:-}" ]; then
    printf '%s\n' "$LAYR_SYSTEMCTL_BIN"
    return 0
  fi
  command -v systemctl
}

# Read-only. Prints missing, active, inactive, failed, or unknown.
unit_observation() {
  local unit="$1"
  local bin listed state
  bin=$(systemctl_bin) || {
    printf 'unknown\n'
    return 0
  }
  listed=$("$bin" list-unit-files --no-legend "$unit" 2>/dev/null || true)
  if ! printf '%s\n' "$listed" | awk -v unit="$unit" '$1 == unit { found = 1 } END { exit(found ? 0 : 1) }'; then
    printf 'missing\n'
    return 0
  fi
  state=$("$bin" is-active "$unit" 2>/dev/null || true)
  state=${state%%$'\n'*}
  case "$state" in
    active | inactive | failed) printf '%s\n' "$state" ;;
    *) printf 'unknown\n' ;;
  esac
}

# installed: current release has index.html and both LAYR units exist, and the web
# service is active, and the kiosk unit is not failed.
# partial: some of those pieces exist.
# broken: the pieces exist, but the web service is down or the kiosk unit failed.
# not-installed: no current release and neither LAYR unit.
# uncertain: systemd could not be read. Do not install or switch on a guess.
inspect_install() {
  local root current target
  root=$(layr_root)
  INSTALL_STATE=not-installed
  ACTIVE_DISPLAY=uncertain
  RELEASE_LABEL=absent
  RELEASE_OK=0
  WEB_STATE=unknown
  KIOSK_STATE=unknown
  KS_STATE=unknown
  current="${root}/current"
  if [ -L "$current" ] || [ -e "$current" ]; then
    target=$(readlink -f "$current" 2>/dev/null || true)
    if [ -n "$target" ] && [ -f "$target/index.html" ]; then
      RELEASE_OK=1
      RELEASE_LABEL="ok ${target}"
    else
      RELEASE_LABEL="broken ${target:-$current}"
    fi
  fi
  if ! systemctl_bin >/dev/null 2>&1; then
    ACTIVE_DISPLAY=uncertain
    INSTALL_STATE=uncertain
    return 0
  fi
  WEB_STATE=$(unit_observation layr-web.service)
  KIOSK_STATE=$(unit_observation layr-kiosk.service)
  KS_STATE=$(unit_observation KlipperScreen.service)
  if [ "$WEB_STATE" = "unknown" ] || [ "$KIOSK_STATE" = "unknown" ] || [ "$KS_STATE" = "unknown" ]; then
    ACTIVE_DISPLAY=uncertain
    INSTALL_STATE=uncertain
    return 0
  fi
  if [ "$KIOSK_STATE" = "active" ] && [ "$KS_STATE" = "active" ]; then
    ACTIVE_DISPLAY=both
  elif [ "$KIOSK_STATE" = "active" ]; then
    ACTIVE_DISPLAY=layr
  elif [ "$KS_STATE" = "active" ]; then
    ACTIVE_DISPLAY=klipperscreen
  else
    ACTIVE_DISPLAY=neither
  fi
  if [ "$RELEASE_OK" != 1 ] && [ "$RELEASE_LABEL" = "absent" ] && [ "$WEB_STATE" = "missing" ] && [ "$KIOSK_STATE" = "missing" ]; then
    INSTALL_STATE=not-installed
    return 0
  fi
  if [ "$RELEASE_OK" = 1 ] && [ "$WEB_STATE" != "missing" ] && [ "$KIOSK_STATE" != "missing" ]; then
    if [ "$WEB_STATE" = "active" ] && [ "$KIOSK_STATE" != "failed" ]; then
      INSTALL_STATE=installed
    else
      INSTALL_STATE=broken
    fi
    return 0
  fi
  INSTALL_STATE=partial
}

print_install_status() {
  printf 'install-state: %s\n' "$INSTALL_STATE"
  printf 'active-display: %s\n' "$ACTIVE_DISPLAY"
  printf 'release: %s\n' "$RELEASE_LABEL"
  printf 'layr-web: %s\n' "$WEB_STATE"
  printf 'layr-kiosk: %s\n' "$KIOSK_STATE"
  printf 'klipperscreen: %s\n' "$KS_STATE"
  if [ "$INSTALL_STATE" != "not-installed" ]; then
    case "$ACTIVE_DISPLAY" in
      both | neither | uncertain)
        printf 'automatic-toggle: refused\n'
        ;;
    esac
  fi
}

script_is_complete() {
  local file="$1"
  local last
  [ -f "$file" ] || return 1
  last=$(awk 'NF { line = $0 } END { print line }' "$file")
  [ "$last" = "# LAYR_SCRIPT_END" ]
}

# --- persistent layr command (kept in this file so one download can install it) ---

LAYR_PATH_BEGIN="# BEGIN LAYR command path"
LAYR_PATH_END="# END LAYR command path"

layr_command_path() {
  printf '%s\n' "${HOME}/.local/bin/layr"
}

layr_path_block() {
  cat <<'EOF'

# BEGIN LAYR command path
if [ -d "$HOME/.local/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) PATH="$HOME/.local/bin:$PATH" ;;
  esac
fi
# END LAYR command path
EOF
}

ensure_layr_path_snippet() {
  local file="$1" mode="${2:-always}"
  [ -n "${HOME:-}" ] || return 0
  [ -L "$file" ] && return 0
  if [ -f "$file" ] && grep -q "$LAYR_PATH_BEGIN" "$file"; then
    return 0
  fi
  if [ "$mode" = "if-missing" ] && [ -f "$file" ] && grep -q '\.local/bin' "$file"; then
    return 0
  fi
  if [ ! -e "$file" ]; then
    : >"$file"
    chmod 644 "$file"
  fi
  layr_path_block >>"$file"
}

remove_layr_path_block() {
  local file="$1" tmp
  [ -f "$file" ] || return 0
  [ -L "$file" ] && return 0
  grep -q "$LAYR_PATH_BEGIN" "$file" || return 0
  tmp="${file}.layr-tmp"
  awk -v begin="$LAYR_PATH_BEGIN" -v end="$LAYR_PATH_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    skip != 1 { print }
  ' "$file" >"$tmp"
  mv -f "$tmp" "$file"
}

remove_layr_command_files() {
  local cmd
  cmd=$(layr_command_path)
  remove_layr_path_block "${HOME}/.bashrc"
  remove_layr_path_block "${HOME}/.profile"
  if [ -L "$cmd" ] || [ -e "$cmd" ]; then
    rm -f "$cmd" || return 1
  fi
  printf 'layr-command: removed\n'
}

write_embedded_wrapper() {
  local dest="$1"
  cat >"$dest" <<'LAYR_WRAPPER' || return 1
#!/usr/bin/env bash
# Persistent LAYR command. Installed for the printer user.
# It runs the manager already stored under the LAYR home directory.
# It does not download files, install packages, or read a script from /tmp.
set -euo pipefail

if [ "$(id -u)" = 0 ]; then
  printf 'ERROR: Run layr as the printer user, not as root. Nothing was changed.\n' >&2
  exit 1
fi
if [ -z "${HOME:-}" ]; then
  printf 'ERROR: HOME is not set. Nothing was changed.\n' >&2
  exit 1
fi

LAYR_HOME="${LAYR_HOME:-$HOME/layr}"
MANAGER="${LAYR_BOOTSTRAP:-$LAYR_HOME/bin/bootstrap.sh}"

complete_script() {
  local file="$1" last
  [ -f "$file" ] || return 1
  [ -L "$file" ] && return 1
  last=$(awk 'NF { line = $0 } END { print line }' "$file")
  [ "$last" = "# LAYR_SCRIPT_END" ]
}

mode_safe() {
  local file="$1" mode group other
  mode=$(stat -c '%a' "$file" 2>/dev/null) || return 1
  group=$(((10#$mode / 10) % 10))
  other=$((10#$mode % 10))
  [ $((group & 2)) -eq 0 ] && [ $((other & 2)) -eq 0 ]
}

local_manager() {
  local parent
  [ -n "$MANAGER" ] || return 1
  case "$MANAGER" in
    "$LAYR_HOME"/*) ;;
    *) return 1 ;;
  esac
  parent=$(dirname "$MANAGER")
  [ "$parent" != "/tmp" ] || return 1
  [ -x "$MANAGER" ] || return 1
  mode_safe "$MANAGER" || return 1
  complete_script "$MANAGER"
}

display_script() {
  local candidate
  if [ -n "${LAYR_DISPLAY_SH:-}" ] && [ -f "$LAYR_DISPLAY_SH" ] && [ ! -L "$LAYR_DISPLAY_SH" ]; then
    case "$(dirname "$LAYR_DISPLAY_SH")" in
      /tmp) return 1 ;;
    esac
    printf '%s\n' "$LAYR_DISPLAY_SH"
    return 0
  fi
  for candidate in "$LAYR_HOME/src/deploy/layr-display.sh" "$LAYR_HOME/bin/layr-display.sh"; do
    if complete_script "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

usage() {
  cat <<'EOF'
Usage: layr [status | to-layr | to-klipperscreen | update | repair | diagnose | uninstall | help]

  layr                    Open the LAYR manager menu.
  layr status             Show which display is active. No network and no package install.
  layr to-layr            Switch the panel to LAYR.
  layr to-klipperscreen   Switch the panel to KlipperScreen. This works offline.
  layr update             Update LAYR. This is the action that may download.
  layr repair             Repair LAYR. This is the action that may download.
  layr diagnose           Read-only report.
  layr uninstall          Remove LAYR after confirmation.

--yes skips the uninstall confirmation. Settings and printer photos are kept
unless you also pass --delete-browser. Klipper, Moonraker, AFC, Happy Hare,
and printer configuration are not removed.
EOF
}

run_display() {
  local script action="$1"
  shift
  if ! script=$(display_script); then
    printf 'ERROR: layr-display.sh is not installed on this computer. Nothing was changed.\n' >&2
    printf 'offline-fallback-needs-download: no\n'
    exit 1
  fi
  exec bash "$script" "$action" "$@"
}

main() {
  local cmd="${1:-}" script=""
  if [ "$#" -gt 0 ]; then
    shift
  fi
  case "$cmd" in
    help | -h | --help)
      usage
      exit 0
      ;;
    "" | menu)
      if ! local_manager; then
        printf 'ERROR: The LAYR manager is not installed in %s.\n' "$LAYR_HOME/bin" >&2
        printf 'The first install uses the long command in INSTALL-FOR-TESTERS.md. Nothing was changed.\n' >&2
        exit 1
      fi
      exec bash "$MANAGER" "$@"
      ;;
    status | --status)
      if local_manager; then
        exec bash "$MANAGER" --status "$@"
      fi
      if script=$(display_script); then
        exec bash "$script" status
      fi
      printf 'install-state: not-installed\n'
      printf 'changed=no\n'
      printf 'display-changed=no\n'
      printf 'offline-fallback-needs-download: no\n'
      exit 0
      ;;
    to-klipperscreen | switch-klipperscreen | --switch-klipperscreen)
      if local_manager; then
        exec bash "$MANAGER" --switch-klipperscreen "$@"
      fi
      run_display to-klipperscreen "$@"
      ;;
    to-layr | switch-layr | --switch-display)
      if ! local_manager; then
        printf 'ERROR: The LAYR manager is not installed. The display was not changed.\n' >&2
        exit 1
      fi
      exec bash "$MANAGER" --switch-display "$@"
      ;;
    update | --update)
      if ! local_manager; then
        printf 'ERROR: The LAYR manager is not installed. Nothing was updated.\n' >&2
        exit 1
      fi
      exec bash "$MANAGER" --update "$@"
      ;;
    repair | --repair)
      if ! local_manager; then
        printf 'ERROR: The LAYR manager is not installed. Nothing was repaired.\n' >&2
        exit 1
      fi
      exec bash "$MANAGER" --repair "$@"
      ;;
    diagnose | diagnostics)
      if ! local_manager; then
        printf 'ERROR: The LAYR manager is not installed. Nothing was changed.\n' >&2
        exit 1
      fi
      exec bash "$MANAGER" diagnose "$@"
      ;;
    uninstall | --uninstall)
      if ! local_manager; then
        printf 'ERROR: The LAYR manager is not installed. Nothing was removed.\n' >&2
        printf 'The layr command was left in place.\n' >&2
        exit 1
      fi
      exec bash "$MANAGER" --uninstall "$@"
      ;;
    *)
      if ! local_manager; then
        printf 'ERROR: The LAYR manager is not installed. Nothing was changed.\n' >&2
        exit 1
      fi
      exec bash "$MANAGER" "$cmd" "$@"
      ;;
  esac
}

main "$@"
# LAYR_SCRIPT_END
LAYR_WRAPPER
  script_is_complete "$dest" || die "The layr command text was incomplete. Nothing else was changed."
}

refuse_layr_symlinks() {
  local path root
  root=$(layr_root)
  for path in "$HOME/.local" "$HOME/.local/bin" "$HOME/.local/bin/layr" "$root" "$root/bin"; do
    if [ -L "$path" ]; then
      die "Refusing to install the layr command through a symlink ($path). Nothing else was changed."
    fi
  done
}

prepare_owned_dir() {
  local dir="$1" owner
  mkdir -p "$dir" || return 1
  if [ -L "$dir" ]; then
    die "Refusing to install the layr command through a symlink ($dir). Nothing else was changed."
  fi
  owner=$(stat -c '%u' "$dir") || return 1
  if [ "$owner" != "$(id -u)" ]; then
    die "Refusing $dir because another user owns it. Nothing else was changed."
  fi
  chmod u+rwx,go-w "$dir" || return 1
}

install_private_copy() {
  local src="$1" dest="$2" mode="$3" dir tmp
  [ -f "$src" ] || return 1
  dir=$(dirname "$dest")
  prepare_owned_dir "$dir" || return 1
  if [ -e "$dest" ] && [ ! -L "$dest" ] && [ "$src" -ef "$dest" ]; then
    chmod "$mode" "$dest" || return 1
    return 0
  fi
  tmp=$(mktemp -p "$dir" ".layr-copy.XXXXXX") || return 1
  cp "$src" "$tmp" || {
    rm -f "$tmp"
    return 1
  }
  chmod "$mode" "$tmp" || {
    rm -f "$tmp"
    return 1
  }
  if [ -f "$dest" ] && [ ! -L "$dest" ] && command -v cmp >/dev/null 2>&1 && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    chmod "$mode" "$dest" || return 1
    return 0
  fi
  if [ -L "$dest" ]; then
    rm -f "$dest" || return 1
  fi
  mv -f "$tmp" "$dest" || return 1
  chmod "$mode" "$dest" || return 1
}

deploy_source_dir() {
  local dir
  dir=$SCRIPT_DIR
  if script_is_complete "$dir/layr-display.sh" && script_is_complete "$dir/lib.sh" && script_is_complete "$dir/uninstall.sh"; then
    printf '%s\n' "$dir"
    return 0
  fi
  dir="$(layr_root)/src/deploy"
  if script_is_complete "$dir/layr-display.sh" && script_is_complete "$dir/lib.sh" && script_is_complete "$dir/uninstall.sh"; then
    printf '%s\n' "$dir"
    return 0
  fi
  return 1
}

copy_support_scripts() {
  local src name dest root
  src=$(deploy_source_dir) || {
    printf 'layr-scripts: not-copied\n'
    return 0
  }
  root=$(layr_root)
  prepare_owned_dir "$root/bin" || return 1
  for name in layr-display.sh lib.sh uninstall.sh rollback.sh; do
    dest="$root/bin/$name"
    if [ -f "$src/$name" ]; then
      install_private_copy "$src/$name" "$dest" 755 || return 1
    fi
  done
}

install_manager_copy() {
  local source dest newer
  source=$SCRIPT_PATH
  if [ "${LAYR_MANAGER_FROM_CHECKOUT:-0}" = 1 ]; then
    newer="$(layr_root)/src/deploy/bootstrap.sh"
    if script_is_complete "$newer" && grep -q 'layr-command:' "$newer"; then
      source=$newer
    fi
  fi
  dest="$(layr_root)/bin/bootstrap.sh"
  install_private_copy "$source" "$dest" 755 || return 1
  script_is_complete "$dest" || die "The installed LAYR manager is incomplete. The display was not changed."
}

install_wrapper_command() {
  local dest dir tmp installed=0
  dir="${HOME}/.local/bin"
  dest=$(layr_command_path)
  case "$dir" in
    "$HOME"/.local/bin) ;;
    *) die "Refusing to install the layr command outside the printer user's home." ;;
  esac
  prepare_owned_dir "$dir" || return 1
  tmp=$(mktemp -p "$dir" ".layr-command.XXXXXX") || return 1
  if [ -f "${SCRIPT_DIR}/layr" ] && script_is_complete "${SCRIPT_DIR}/layr"; then
    cp "${SCRIPT_DIR}/layr" "$tmp" || {
      rm -f "$tmp"
      return 1
    }
  else
    write_embedded_wrapper "$tmp" || {
      rm -f "$tmp"
      return 1
    }
  fi
  chmod 755 "$tmp" || {
    rm -f "$tmp"
    return 1
  }
  if [ -f "$dest" ] && [ ! -L "$dest" ] && command -v cmp >/dev/null 2>&1 && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    chmod 755 "$dest"
    installed=0
  else
    if [ -L "$dest" ]; then
      rm -f "$dest"
    fi
    mv -f "$tmp" "$dest" || return 1
    chmod 755 "$dest" || return 1
    installed=1
  fi
  if ! script_is_complete "$dest"; then
    rm -f "$dest"
    die "The layr command was incomplete and was not left in place."
  fi
  printf 'layr-command-path: %s\n' "$dest"
  if [ "$installed" = 1 ]; then
    printf 'layr-command: installed\n'
    printf 'Next time, from any directory: layr\n'
    printf 'Offline recovery: layr to-klipperscreen --yes\n'
  else
    printf 'layr-command: ready\n'
  fi
  ensure_layr_path_snippet "${HOME}/.bashrc" always
  ensure_layr_path_snippet "${HOME}/.profile" if-missing
}

ensure_layr_command() {
  LAYR_COMMAND_ENSURED=1
  if [ -z "${HOME:-}" ]; then
    die "HOME is not set. The layr command was not installed."
  fi
  if [ "$DRY_RUN" = 1 ]; then
    printf 'layr-command: would-install\n'
    printf 'layr-command-path: %s\n' "$(layr_command_path)"
    return 0
  fi
  refuse_layr_symlinks
  install_manager_copy || return 1
  copy_support_scripts || return 1
  install_wrapper_command || return 1
}

resolve_uninstall_script() {
  local root candidate
  if [ -n "${LAYR_UNINSTALL_SH:-}" ] && [ -f "$LAYR_UNINSTALL_SH" ]; then
    printf '%s\n' "$LAYR_UNINSTALL_SH"
    return 0
  fi
  root=$(layr_root)
  for candidate in "${SCRIPT_DIR}/uninstall.sh" "${root}/bin/uninstall.sh" "${root}/src/deploy/uninstall.sh"; do
    if script_is_complete "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

confirm_uninstall() {
  local reply
  if [ "${ASSUME_YES:-0}" = 1 ] || [ "${LAYR_UNINSTALL_YES:-0}" = 1 ]; then
    return 0
  fi
  if [ "${DRY_RUN:-0}" = 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    printf 'No terminal for the uninstall question. Re-run with --yes. Nothing was removed.\n'
    return 1
  fi
  read -r -p "Uninstall LAYR now? [y/N] " reply || return 1
  [[ "$reply" =~ ^[Yy]$ ]]
}

confirm_delete_browser() {
  local reply
  if [ "${DELETE_BROWSER:-0}" = 1 ] || [ "${LAYR_DELETE_BROWSER:-}" = "yes" ]; then
    return 0
  fi
  if [ "${LAYR_DELETE_BROWSER:-}" = "no" ]; then
    return 1
  fi
  if [ "${ASSUME_YES:-0}" = 1 ] || [ "${DRY_RUN:-0}" = 1 ] || [ ! -t 0 ]; then
    return 1
  fi
  cat <<EOF
Delete personal LAYR settings and printer photos?
This removes only:
  ${HOME}/.config/layr-chromium
  ${HOME}/.cache/layr-wpe
  ${HOME}/.local/share/layr-wpe
Those hold this screen's LAYR settings and the idle-home printer photo.
Klipper, Moonraker, AFC, Happy Hare, printer.cfg, moonraker.conf, and mmu.cfg are not in those folders.
EOF
  read -r -p "Delete personal settings and printer photos? [y/N] " reply || return 1
  [[ "$reply" =~ ^[Yy]$ ]]
}

remove_browser_data() {
  local path
  [ -n "${HOME:-}" ] || return 1
  for path in "${HOME}/.config/layr-chromium" "${HOME}/.cache/layr-wpe" "${HOME}/.local/share/layr-wpe"; do
    case "$path" in
      "${HOME}/.config/layr-chromium" | "${HOME}/.cache/layr-wpe" | "${HOME}/.local/share/layr-wpe") ;;
      *) return 1 ;;
    esac
    if [ -L "$path" ]; then
      rm -f "$path" || return 1
      continue
    fi
    if [ ! -e "$path" ]; then
      continue
    fi
    if [ -n "${LAYR_RM:-}" ]; then
      "$LAYR_RM" -rf "$path" || return 1
    else
      rm -rf "$path" || return 1
    fi
  done
  printf 'browser-data: removed\n'
}

remove_layr_home_tree() {
  local root
  root=$(layr_root)
  [ -n "$root" ] || return 1
  [ "$root" != "/" ] || return 1
  [ "$root" != "$HOME" ] || return 1
  case "$root" in
    "$HOME"/*) ;;
    *)
      printf 'uninstall-refused: home\n'
      return 1
      ;;
  esac
  if [ "$(basename "$root")" != "layr" ]; then
    printf 'uninstall-refused: home\n'
    return 1
  fi
  if [ ! -e "$root" ] && [ ! -L "$root" ]; then
    printf 'layr-home: absent\n'
    return 0
  fi
  if [ -L "$root" ]; then
    rm -f "$root" || return 1
    printf 'layr-home: removed-link\n'
    return 0
  fi
  if [ -n "${LAYR_RM:-}" ]; then
    "$LAYR_RM" -rf "$root" || return 1
  else
    rm -rf "$root" || return 1
  fi
  printf 'layr-home: removed\n'
}

print_uninstall_plan() {
  cat <<EOF
Uninstall LAYR?

This will:
  - turn KlipperScreen back on first, when that service is installed
  - stop and remove layr-web and layr-kiosk
  - delete LAYR releases, scripts, and the layr command

This will not:
  - remove apt packages such as Chromium or cage
  - remove Klipper, Moonraker, AFC, Happy Hare, or a Box Turtle
  - edit printer.cfg, moonraker.conf, or mmu.cfg
  - delete personal settings or printer photos unless you say yes to that separate question

EOF
}

# Restore KlipperScreen first when it is installed. Refuse when the kiosk is the
# only display. Remove the layr command only after the files are gone.
uninstall_layr() {
  local script want_browser=0
  printf 'action: uninstall\n'
  print_uninstall_plan
  if [ "$ACTIVE_DISPLAY" = "uncertain" ] || [ "$INSTALL_STATE" = "uncertain" ]; then
    printf 'uninstall-refused: uncertain\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    printf 'The layr command was left in place.\n'
    return 1
  fi
  if [ "$KS_STATE" = "missing" ] && [ "$KIOSK_STATE" = "active" ]; then
    printf 'uninstall-refused: no-alternative-display\n'
    printf 'KlipperScreen is not installed, and the LAYR kiosk is on the screen. Uninstall was not started.\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    printf 'The layr command was left in place.\n'
    return 1
  fi
  if ! confirm_uninstall; then
    printf 'Cancelled. Nothing was removed.\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    printf 'The layr command was left in place.\n'
    return 1
  fi
  if confirm_delete_browser; then
    want_browser=1
    if [ "${DRY_RUN:-0}" = 1 ]; then
      printf 'browser-data: would-remove\n'
    fi
  else
    printf 'browser-data: kept\n'
  fi
  if [ "${DRY_RUN:-0}" = 1 ]; then
    printf 'uninstall: dry-run\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    return 0
  fi
  if [ "$KS_STATE" != "missing" ]; then
    if ! switch_to_klipperscreen; then
      printf 'uninstall-aborted: display\n'
      printf 'changed=no\n'
      printf 'display-changed=no\n'
      printf 'The layr command was left in place.\n'
      return 1
    fi
  else
    printf 'klipperscreen: absent\n'
    printf 'kiosk-active: no\n'
  fi
  if [ "$WEB_STATE" = "missing" ] && [ "$KIOSK_STATE" = "missing" ]; then
    printf 'units: absent\n'
  elif ! script=$(resolve_uninstall_script); then
    printf 'uninstall-aborted: uninstall.sh missing\n'
    printf 'changed=no\n'
    printf 'The layr command was left in place.\n'
    return 1
  elif ! bash "$script" --yes; then
    printf 'uninstall-aborted: units\n'
    printf 'changed=no\n'
    printf 'The layr command was left in place.\n'
    return 1
  fi
  if ! remove_layr_home_tree; then
    printf 'uninstall-aborted: files\n'
    printf 'changed=no\n'
    printf 'The layr command was left in place.\n'
    return 1
  fi
  if [ "$want_browser" = 1 ]; then
    if ! remove_browser_data; then
      printf 'uninstall-aborted: browser-data\n'
      printf 'The layr command was left in place.\n'
      return 1
    fi
  fi
  if ! remove_layr_command_files; then
    printf 'uninstall-aborted: command\n'
    return 1
  fi
  printf 'uninstall: complete\n'
  printf 'changed=yes\n'
  printf 'apt-removed: no\n'
  printf 'printer-config: kept\n'
}

# --- end persistent layr command ---

resolve_display_script() {
  local root candidate
  if [ -n "${LAYR_DISPLAY_SH:-}" ] && [ -f "$LAYR_DISPLAY_SH" ]; then
    printf '%s\n' "$LAYR_DISPLAY_SH"
    return 0
  fi
  root=$(layr_root)
  candidate="${root}/src/deploy/layr-display.sh"
  if script_is_complete "$candidate"; then
    printf '%s\n' "$candidate"
    return 0
  fi
  candidate="${root}/bin/layr-display.sh"
  if script_is_complete "$candidate"; then
    printf '%s\n' "$candidate"
    return 0
  fi
  candidate="${SCRIPT_DIR}/layr-display.sh"
  if script_is_complete "$candidate"; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

# Calls layr-display.sh. Does not stop or start units itself, and does not
# probe the LAYR page or GitHub. A missing KlipperScreen unit is not installed.
switch_to_klipperscreen() {
  local script
  local -a args
  if [ "$ACTIVE_DISPLAY" = "uncertain" ]; then
    printf 'switch-refused: uncertain\n'
    printf 'automatic-toggle: refused\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    print_offline_fallback
    return 1
  fi
  if [ "$KS_STATE" = "missing" ]; then
    printf 'klipperscreen: absent\n'
    printf 'switch-refused: klipperscreen-absent\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    printf 'KlipperScreen is not installed. It was not installed or removed, and the LAYR kiosk was not stopped.\n'
    print_offline_fallback
    return 1
  fi
  if [ "$ACTIVE_DISPLAY" = "klipperscreen" ]; then
    printf 'already-active: klipperscreen\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    print_offline_fallback
    return 0
  fi
  if [ "$ACTIVE_DISPLAY" = "both" ] || [ "$ACTIVE_DISPLAY" = "neither" ]; then
    printf 'display-conflict: %s\n' "$ACTIVE_DISPLAY"
    printf 'explicit-switch: klipperscreen\n'
  fi
  if ! script=$(resolve_display_script); then
    printf 'switch-refused: layr-display.sh missing\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    print_offline_fallback
    return 1
  fi
  args=(to-klipperscreen --yes)
  if [ "$DRY_RUN" = 1 ]; then
    args+=(--dry-run)
  fi
  print_offline_fallback
  if ! bash "$script" "${args[@]}"; then
    printf 'display-changed=no\n'
    printf 'changed=no\n'
    printf 'The switch back to KlipperScreen failed. The LAYR page was not required for this attempt.\n'
    return 1
  fi
  if [ "$DRY_RUN" = 1 ]; then
    printf 'display-changed=no\n'
    printf 'changed=no\n'
    return 0
  fi
  printf 'display-switch: klipperscreen\n'
  printf 'display-changed=yes\n'
  return 0
}

switch_to_layr() {
  local script
  local -a args
  if [ "$ACTIVE_DISPLAY" = "uncertain" ]; then
    printf 'switch-refused: uncertain\n'
    printf 'automatic-toggle: refused\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    print_offline_fallback
    return 1
  fi
  if [ "$ACTIVE_DISPLAY" = "layr" ]; then
    printf 'already-active: layr\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    return 0
  fi
  if [ "$ACTIVE_DISPLAY" = "both" ] || [ "$ACTIVE_DISPLAY" = "neither" ]; then
    printf 'display-conflict: %s\n' "$ACTIVE_DISPLAY"
    printf 'explicit-switch: layr\n'
  fi
  if ! script=$(resolve_display_script); then
    printf 'switch-refused: layr-display.sh missing\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    print_offline_fallback
    return 1
  fi
  args=(to-layr --yes)
  if [ "$DRY_RUN" = 1 ]; then
    args+=(--dry-run)
  fi
  print_offline_fallback
  if ! bash "$script" "${args[@]}"; then
    printf 'display-changed=no\n'
    printf 'changed=no\n'
    printf 'The LAYR kiosk was not left in place. KlipperScreen was not stopped, or it was restored, when the kiosk did not stay up.\n'
    return 1
  fi
  if [ "$DRY_RUN" = 1 ]; then
    printf 'display-changed=no\n'
    printf 'changed=no\n'
    return 0
  fi
  printf 'display-switch: layr-kiosk\n'
  printf 'display-changed=yes\n'
  return 0
}

print_switch_menu() {
  cat <<'EOF'
Same installer, already on this Pi. Packages are not downloaded unless you choose Update or Repair.
Uninstall asks first. It does not remove apt packages or printer configuration.

  1) Switch to LAYR
  2) Switch to KlipperScreen
  3) Update
  4) Repair
  5) Diagnostics
  6) Exit
  7) Uninstall LAYR
EOF
  printf 'Choosing Exit changes nothing. KlipperScreen stays installed either way.\n'
  if [ "$ACTIVE_DISPLAY" = "both" ] || [ "$ACTIVE_DISPLAY" = "neither" ] || [ "$ACTIVE_DISPLAY" = "uncertain" ]; then
    printf 'Status is %s, so this run will not switch the display by itself.\n' "$ACTIVE_DISPLAY"
  fi
}

read_menu_choice() {
  local reply
  if [ -n "${LAYR_MENU_CHOICE:-}" ]; then
    reply=$LAYR_MENU_CHOICE
  elif [ ! -t 0 ]; then
    printf 'exit\n'
    return 0
  else
    read -r -p "Choice [1-7]: " reply || {
      printf 'exit\n'
      return 0
    }
  fi
  case "$reply" in
    1 | switch-layr) printf 'switch-layr\n' ;;
    2 | switch-klipperscreen | klipperscreen) printf 'switch-klipperscreen\n' ;;
    3 | update) printf 'update\n' ;;
    4 | repair) printf 'repair\n' ;;
    5 | diagnostics | diagnose) printf 'diagnostics\n' ;;
    6 | exit | '') printf 'exit\n' ;;
    7 | uninstall) printf 'uninstall\n' ;;
    *) printf 'invalid\n' ;;
  esac
}

run_menu_diagnostics() {
  printf 'action: diagnostics\n'
  printf 'reinstall: no\n'
  detect_platform
  printf 'support=%s\n' "$PLATFORM_SUPPORT"
  printf 'kind=%s\n' "${PLATFORM_KIND:-unknown}"
  printf 'os=%s\n' "${PLATFORM_PRETTY:-unknown}"
  printf 'arch=%s\n' "$PLATFORM_ARCH"
  printf 'reason=%s\n' "$PLATFORM_REASON"
  report_display
  report_touch
  probe_moonraker
  print_controller_guidance
  warn_moonraker_conf
  report_services
  print_install_status
  printf 'changed=no\n'
  printf 'display-changed=no\n'
  print_offline_fallback
}

finish_noop() {
  local how="$1"
  printf 'menu: %s\n' "$how"
  printf 'choice: exit\n'
  printf 'reinstall: no\n'
  printf 'changed=no\n'
  printf 'display-changed=no\n'
  print_offline_fallback
}

# Returns only when the choice is Update or Repair. Every other choice exits.
installed_menu() {
  local choice
  print_switch_menu
  if [ ! -t 0 ] && [ -z "${LAYR_MENU_CHOICE:-}" ]; then
    finish_noop skipped
    exit 0
  fi
  choice=$(read_menu_choice)
  case "$choice" in
    exit)
      finish_noop exit
      exit 0
      ;;
    invalid)
      printf 'menu: invalid\n'
      printf 'reinstall: no\n'
      printf 'changed=no\n'
      printf 'display-changed=no\n'
      exit 1
      ;;
    diagnostics)
      run_menu_diagnostics
      exit 0
      ;;
    switch-layr)
      printf 'reinstall: no\n'
      switch_to_layr || exit 1
      exit 0
      ;;
    switch-klipperscreen)
      printf 'reinstall: no\n'
      switch_to_klipperscreen || exit 1
      exit 0
      ;;
    update)
      WANT_UPDATE=1
      ASSUME_YES=1
      HOLD_DISPLAY=1
      printf 'action: update\n'
      return 0
      ;;
    repair)
      WANT_REPAIR=1
      ASSUME_YES=1
      HOLD_DISPLAY=1
      printf 'action: repair\n'
      return 0
      ;;
    uninstall)
      uninstall_layr || exit 1
      exit 0
      ;;
    *)
      printf 'menu: invalid\n'
      printf 'reinstall: no\n'
      printf 'changed=no\n'
      printf 'display-changed=no\n'
      exit 1
      ;;
  esac
}

usage() {
  cat <<'EOF'
Usage: bash deploy/bootstrap.sh [diagnose] [--preflight] [--dry-run] [--yes]
                                [--switch-display] [--switch-klipperscreen]
                                [--update] [--repair] [--status] [--uninstall]
                                [--delete-browser] [--install-command]
                                [--moonraker URL] [--port N]
                                [--dist DIR] [--ref NAME] [--sample-touch]

The first run installs LAYR in preview mode and adds a layr command.
KlipperScreen stays as it is until you confirm a display switch
(or pass both --yes and --switch-display).

When LAYR is already installed, layr (or this command) does not download,
build, or reinstall. It prints the active display and a menu:

  1) Switch to LAYR
  2) Switch to KlipperScreen
  3) Update
  4) Repair
  5) Diagnostics
  6) Exit
  7) Uninstall LAYR

Exit changes nothing. --update and --repair are the actions that install again,
and they leave the current display alone unless you also name a switch.
--status and a plain menu do not use the network.
--switch-klipperscreen does not need the LAYR page or a network connection.
--uninstall asks first, restores KlipperScreen when it is installed, and does
not remove apt packages or printer configuration. --yes does not delete
personal settings; add --delete-browser for that separate choice.
Switching calls layr-display.sh. The Pi is not rebooted.
EOF
}

bootstrap_main() {
  local action_word="${1:-}"
  DIST_ARG=""
  PORT=7180
  MOONRAKER="http://localhost:7125"
  DRY_RUN=0
  ASSUME_YES=0
  SWITCH=0
  SWITCH_KS=0
  WANT_UPDATE=0
  WANT_REPAIR=0
  WANT_UNINSTALL=0
  DELETE_BROWSER=0
  STATUS_ONLY=0
  INSTALL_COMMAND_ONLY=0
  LAYR_COMMAND_ENSURED=0
  HOLD_DISPLAY=0
  INSTALLED_REPORT=0
  PREFLIGHT_ONLY=0
  DO_DIAGNOSE=0
  RELOAD_KIOSK=0
  SAMPLE_TOUCH=0
  REF="${LAYR_REF:-main}"
  REF_EXPLICIT=0
  if [ -n "${LAYR_REF:-}" ]; then
    REF_EXPLICIT=1
  fi
  if [ "$action_word" = "diagnose" ]; then
    DO_DIAGNOSE=1
    shift
  fi
  while [ $# -gt 0 ]; do
    case "$1" in
      diagnose) DO_DIAGNOSE=1; shift ;;
      --preflight) PREFLIGHT_ONLY=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --yes) ASSUME_YES=1; shift ;;
      --switch-display) SWITCH=1; shift ;;
      --switch-klipperscreen) SWITCH_KS=1; shift ;;
      --update) WANT_UPDATE=1; shift ;;
      --repair) WANT_REPAIR=1; shift ;;
      --status) STATUS_ONLY=1; shift ;;
      --uninstall) WANT_UNINSTALL=1; shift ;;
      --delete-browser) DELETE_BROWSER=1; shift ;;
      --install-command) INSTALL_COMMAND_ONLY=1; shift ;;
      --reload-kiosk) RELOAD_KIOSK=1; shift ;;
      --sample-touch) SAMPLE_TOUCH=1; shift ;;
      --moonraker) MOONRAKER="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      --dist) DIST_ARG="$2"; shift 2 ;;
      --ref) REF="$2"; REF_EXPLICIT=1; shift 2 ;;
      -h | --help) usage; exit 0 ;;
      *) fail_preflight "Unknown option: $1" ;;
    esac
  done

  if [ "$(id -u)" = 0 ]; then
    fail_preflight "Run this as the printer user (for example pi), not as root. Nothing was changed."
  fi
  if [ "$INSTALL_COMMAND_ONLY" = 1 ]; then
    if [ "$WANT_UNINSTALL" = 1 ] || [ "$SWITCH" = 1 ] || [ "$SWITCH_KS" = 1 ] || [ "$WANT_UPDATE" = 1 ] || [ "$WANT_REPAIR" = 1 ] || [ "$STATUS_ONLY" = 1 ]; then
      fail_preflight "Installing the layr command does not switch, update, or uninstall. Nothing was changed."
    fi
    ensure_layr_command
    exit 0
  fi
  case "$PORT" in
    '' | *[!0-9]*) fail_preflight "Port must be a number." ;;
  esac
  if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ] || [ "$PORT" = 7125 ]; then
    fail_preflight "Pick a port other than 7125 (Moonraker). 7180 is the usual LAYR port."
  fi
  validate_moonraker_url "$MOONRAKER" || fail_preflight "Moonraker URL must be http or https and must not contain a password."
  case "$REF" in
    '' | *[!A-Za-z0-9._/-]* | *..*) fail_preflight "Refusing ref ${REF}." ;;
  esac

  DIST_READY=0
  if [ -n "$DIST_ARG" ]; then
    case "$DIST_ARG" in
      /*) DIST_PATH=$DIST_ARG ;;
      *) DIST_PATH="${CALLER_PWD}/${DIST_ARG}" ;;
    esac
    if [ -d "$DIST_PATH" ]; then
      DIST_PATH=$(cd "$DIST_PATH" && pwd)
    fi
    if [ -f "$DIST_PATH/index.html" ]; then
      DIST_READY=1
    fi
  else
    DIST_PATH=""
  fi

  inspect_install
  print_install_status
  if [ "$SWITCH" = 1 ] && [ "$SWITCH_KS" = 1 ]; then
    fail_preflight "Choose one display, not both. Nothing was changed."
  fi
  if [ "$DELETE_BROWSER" = 1 ] && [ "$WANT_UNINSTALL" != 1 ]; then
    fail_preflight "--delete-browser is only valid with uninstall. Nothing was changed."
  fi
  if [ "$STATUS_ONLY" = 1 ] && { [ "$WANT_UNINSTALL" = 1 ] || [ "$WANT_UPDATE" = 1 ] || [ "$WANT_REPAIR" = 1 ] || [ "$SWITCH" = 1 ] || [ "$SWITCH_KS" = 1 ]; }; then
    fail_preflight "Status does not install, update, or switch. Nothing was changed."
  fi
  if [ "$STATUS_ONLY" = 1 ]; then
    if [ "$INSTALL_STATE" != "not-installed" ]; then
      ensure_layr_command
    fi
    printf 'reinstall: no\n'
    printf 'changed=no\n'
    printf 'display-changed=no\n'
    print_offline_fallback
    exit 0
  fi
  if [ "$WANT_UNINSTALL" = 1 ]; then
    if [ "$WANT_UPDATE" = 1 ] || [ "$WANT_REPAIR" = 1 ] || [ "$SWITCH" = 1 ] || [ "$SWITCH_KS" = 1 ]; then
      fail_preflight "Uninstall does not update or switch in the same run. Nothing was changed."
    fi
    uninstall_layr || exit 1
    exit 0
  fi
  if [ "$INSTALL_STATE" = "not-installed" ] && [ "$SWITCH_KS" = 1 ] && [ "$WANT_UPDATE" != 1 ] && [ "$WANT_REPAIR" != 1 ] && [ "$SWITCH" != 1 ]; then
    printf 'reinstall: no\n'
    switch_to_klipperscreen || exit 1
    exit 0
  fi
  if [ "$INSTALL_STATE" != "not-installed" ]; then
    ensure_layr_command
    if [ "$WANT_UPDATE" = 1 ] || [ "$WANT_REPAIR" = 1 ]; then
      if [ "$SWITCH" != 1 ] && [ "$SWITCH_KS" != 1 ]; then
        HOLD_DISPLAY=1
      fi
      if [ "$WANT_REPAIR" = 1 ]; then
        printf 'action: repair\n'
      else
        printf 'action: update\n'
      fi
      INSTALLED_REPORT=1
    elif [ "$SWITCH" = 1 ] || [ "$SWITCH_KS" = 1 ]; then
      printf 'reinstall: no\n'
      if [ "$SWITCH_KS" = 1 ]; then
        switch_to_klipperscreen || exit 1
      else
        switch_to_layr || exit 1
      fi
      exit 0
    elif [ "$DO_DIAGNOSE" = 1 ] || [ "$PREFLIGHT_ONLY" = 1 ]; then
      INSTALLED_REPORT=1
    else
      installed_menu
      INSTALLED_REPORT=1
    fi
  fi
  if [ -n "$DIST_ARG" ] && [ "$DIST_READY" != 1 ]; then
    fail_preflight "No index.html in ${DIST_PATH}. Nothing was changed."
  fi

  detect_platform
  printf 'support=%s\n' "$PLATFORM_SUPPORT"
  printf 'kind=%s\n' "${PLATFORM_KIND:-unknown}"
  printf 'os=%s\n' "${PLATFORM_PRETTY:-unknown}"
  printf 'arch=%s\n' "$PLATFORM_ARCH"
  printf 'model=%s\n' "${PLATFORM_MODEL:-unknown}"
  printf 'reason=%s\n' "$PLATFORM_REASON"
  print_scope
  report_display
  report_touch
  probe_moonraker
  print_controller_guidance
  warn_moonraker_conf
  report_services
  if [ "$PLATFORM_SUPPORT" != "yes" ]; then
    fail_preflight "$PLATFORM_REASON"
  fi

  local memory disk disk_need mem_need
  if ! choose_source; then
    if [ "${INSTALLED_REPORT:-0}" = 1 ] && { [ "$DO_DIAGNOSE" = 1 ] || [ "$PREFLIGHT_ONLY" = 1 ]; }; then
      printf 'source: unavailable\n'
      printf 'preflight=ok\n'
      printf 'changed=no\n'
      printf 'display-changed=no\n'
      print_offline_fallback
      exit 0
    fi
    fail_preflight "Could not reach GitHub to choose a LAYR release or commit. Nothing was changed."
  fi
  if [ "$SOURCE_MODE" = "build" ] || [ "$SOURCE_MODE" = "deferred" ]; then
    NEED_CLONE=1
  elif scripts_are_local; then
    NEED_CLONE=0
  else
    NEED_CLONE=1
  fi
  plan_packages
  memory=$(mem_mb)
  disk=$(disk_free_mb)
  disk_need=$(need_disk_mb)
  mem_need=$(need_mem_mb)
  printf 'memory_mb=%s\n' "$memory"
  printf 'disk_free_mb=%s\n' "$disk"
  print_source_line
  if [ "${#PACKAGES[@]}" -eq 0 ]; then
    printf 'package: none\n'
  else
    local pkg
    for pkg in "${PACKAGES[@]}"; do
      printf 'package: %s\n' "$pkg"
    done
  fi
  printf 'klipperscreen: left as it is until you confirm a switch\n'
  if [ -e "$(layr_root)/current" ]; then
    printf 'install-kind: update\n'
  else
    printf 'install-kind: first\n'
  fi
  if [ "$SWITCH" = 1 ]; then
    printf 'display-switch: planned after the page answers\n'
  else
    printf 'display-switch: no\n'
  fi
  print_recovery_bootstrap

  case "$memory" in
    '' | *[!0-9]*) fail_preflight "Could not read memory." ;;
  esac
  case "$disk" in
    '' | *[!0-9]*) fail_preflight "Could not read free disk." ;;
  esac
  if [ "$memory" -lt "$mem_need" ]; then
    fail_preflight "Not enough memory (${memory} MB). A build needs 512 MB; a release asset needs 256 MB."
  fi
  if [ "$disk" -lt "$disk_need" ]; then
    fail_preflight "Not enough free disk (${disk} MB). Need ${disk_need} MB. Nothing was changed."
  fi
  if [ "$SOURCE_MODE" = "build" ] && [ "$memory" -lt 1024 ]; then
    printf 'warning: memory is under 1024 MB. Building on the Pi may be slow.\n'
  fi
  if ! sudo_ok; then
    if [ "$DO_DIAGNOSE" = 1 ]; then
      printf 'sudo: missing\n'
      printf 'preflight=fail\n'
      printf 'changed=no\n'
      exit 1
    fi
    fail_preflight "sudo is required to install packages and the LAYR services. Run as the printer user, not root. Nothing was changed."
  fi
  printf 'preflight=ok\n'
  if [ "$DO_DIAGNOSE" = 1 ] || [ "$PREFLIGHT_ONLY" = 1 ]; then
    printf 'changed=no\n'
    printf 'startup-check: bash %s diagnose\n' "$SCRIPT_PATH"
    exit 0
  fi

  if [ "$DRY_RUN" != 1 ] && [ "$ASSUME_YES" != 1 ]; then
    confirm_answer "Install LAYR in preview mode? KlipperScreen stays as it is." || fail_preflight "Cancelled. Nothing was changed."
  fi

  if [ "${#PACKAGES[@]}" -gt 0 ]; then
    local apt_bin try apt_ok
    if [ -n "${LAYR_APT_GET:-}" ]; then
      apt_bin=$LAYR_APT_GET
    else
      apt_bin=apt-get
    fi
    apt_ok=1
    try=1
    while [ "$try" -le 4 ]; do
      # env keeps the restart lock on the command line, so a locked-down sudo
      # cannot drop it and needrestart cannot restart Klipper or Moonraker.
      if run_root env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l "$apt_bin" update; then
        apt_ok=0
        break
      fi
      try=$((try + 1))
      sleep "${LAYR_APT_RETRY_SLEEP:-2}"
    done
    if [ "$apt_ok" != 0 ]; then
      printf 'apt-failed=yes\n'
      printf 'display-changed=no\n'
      printf 'Package install did not finish. If apt was locked, wait and run the same command again. The display was not changed.\n'
      print_recovery_bootstrap
      exit 1
    fi
    run_root env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l "$apt_bin" install -y "${PACKAGES[@]}"
  fi

  if [ "$SOURCE_MODE" = "deferred" ] && [ "$DRY_RUN" != 1 ]; then
    if ! choose_source; then
      printf 'display-changed=no\n'
      die "Could not choose a LAYR source after installing curl and python3. The display was not changed."
    fi
    print_source_line
    if [ "$ASSUME_YES" != 1 ]; then
      confirm_answer "Continue with ${SOURCE_MODE}?" || die "Cancelled. Packages may already be installed. The display was not changed."
    fi
  fi

  apply_groups
  obtain_files
  if [ "$SOURCE_MODE" = "deferred" ] && [ "$DRY_RUN" = 1 ]; then
    printf 'install: skipped in dry run until curl and python3 exist\n'
  elif [ "$SOURCE_MODE" = "release" ] && [ "$DRY_RUN" = 1 ]; then
    printf 'install: skipped in dry run until the release archive is downloaded\n'
  elif [ "$SOURCE_MODE" = "build" ] && [ "$DRY_RUN" = 1 ]; then
    printf 'install: skipped in dry run until the build finishes\n'
  else
    install_layr "$DIST_PATH"
    if [ "$DRY_RUN" = 1 ]; then
      if [ "${LAYR_COMMAND_ENSURED:-0}" != 1 ]; then
        printf 'layr-command: would-install\n'
        printf 'layr-command-path: %s\n' "$(layr_command_path)"
      fi
    else
      if ! LAYR_MANAGER_FROM_CHECKOUT=1 ensure_layr_command; then
        warn "LAYR is installed, but the layr command was not added."
      fi
    fi
  fi

  printf 'preview: http://127.0.0.1:%s/?moonraker=%s#/home\n' "$PORT" "$MOONRAKER"
  printf 'startup-check: bash %s diagnose\n' "$SCRIPT_PATH"
  print_controller_guidance
  print_recovery_bootstrap
  maybe_switch_display
}

apply_groups() {
  local missing=() g have joined
  have=" $(group_line) "
  for g in video render input; do
    case "$have" in
      *" $g "*) ;;
      *) missing+=("$g") ;;
    esac
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    printf 'groups: video render input present\n'
    return 0
  fi
  printf 'groups-missing: %s\n' "${missing[*]}"
  joined=$(printf '%s,' "${missing[@]}")
  joined=${joined%,}
  printf 'note: adding those groups does not restart the Pi and does not change udev rules.\n'
  run_root usermod -aG "$joined" "$(id -un)" || warn "Could not add groups ${joined}."
}

# A release bundle is only the web files. The one downloaded bootstrap does not contain
# install.sh, so a release install clones that commit when this directory has no scripts.
ensure_scripts() {
  local pin=""
  [ "${NEED_CLONE:-0}" = 1 ] || return 0
  [ "$SOURCE_MODE" = "build" ] && return 0
  [ "$SOURCE_MODE" = "deferred" ] && return 0
  if [ "$DRY_RUN" = 1 ]; then
    printf 'would-clone-scripts: yes\n'
    return 0
  fi
  pin=${SOURCE_SHA:-}
  if [ -z "$pin" ] && [ -n "${SOURCE_TAG:-}" ]; then
    pin=$(resolve_ref "$SOURCE_TAG") || die "Could not resolve ${SOURCE_TAG}. The display was not changed."
  fi
  if [ -z "$pin" ]; then
    pin=$(resolve_ref main) || die "Could not resolve main. The display was not changed."
  fi
  clone_sha "$pin"
}

obtain_files() {
  ensure_scripts
  case "$SOURCE_MODE" in
    dist) ;;
    release)
      if [ "$DRY_RUN" = 1 ]; then
        printf 'would-download: %s\n' "$RELEASE_URL"
        return 0
      fi
      download_release
      ;;
    build)
      if [ "$DRY_RUN" = 1 ]; then
        printf 'would-clone: %s\n' "$SOURCE_SHA"
        return 0
      fi
      clone_sha "$SOURCE_SHA"
      if [ -f "${HOME}/layr/src/dist/index.html" ]; then
        info "Reusing built files for ${SOURCE_SHA}"
      else
        build_in_tree
      fi
      DIST_PATH="${HOME}/layr/src/dist"
      ;;
    deferred)
      return 0
      ;;
  esac
}

download_release() {
  local tarball shafile expected dest
  tarball=$(mktemp)
  shafile=$(mktemp)
  http_get "$RELEASE_SHA_URL" "$shafile" 100000 || die "Could not download the release checksum. The display was not changed."
  expected=$(read_sha_token "$shafile") || die "Release checksum was not a sha256. The display was not changed."
  rm -f "$shafile"
  http_get "$RELEASE_URL" "$tarball" 80000000 || die "Could not download the release archive. The display was not changed."
  if ! verify_sha256 "$tarball" "$expected"; then
    rm -f "$tarball"
    die "Release checksum did not match. The archive was not installed. The display was not changed."
  fi
  dest=$(mktemp -d)
  tar -xzf "$tarball" -C "$dest"
  rm -f "$tarball"
  if [ -f "$dest/index.html" ]; then
    DIST_PATH=$dest
  elif [ -f "$dest/dist/index.html" ]; then
    DIST_PATH=$dest/dist
  else
    die "Release archive has no index.html. The display was not changed."
  fi
  # The one-file bootstrap does not contain install.sh. A release archive ships deploy/
  # beside index.html so rollback and the display switch land in ~/layr/src/deploy.
  if [ -f "$dest/deploy/install.sh" ]; then
    if [ -d "${HOME}/layr/src/.git" ] && [ -f "${HOME}/layr/src/deploy/install.sh" ]; then
      RELEASE_DEPLOY="${HOME}/layr/src/deploy"
    else
      mkdir -p "${HOME}/layr/src"
      rm -rf "${HOME}/layr/src/deploy"
      cp -a "$dest/deploy" "${HOME}/layr/src/deploy"
      RELEASE_DEPLOY="${HOME}/layr/src/deploy"
    fi
  elif [ -f "${SCRIPT_DIR}/install.sh" ]; then
    RELEASE_DEPLOY=$SCRIPT_DIR
  elif [ -f "${HOME}/layr/src/deploy/install.sh" ]; then
    RELEASE_DEPLOY="${HOME}/layr/src/deploy"
  else
    die "Release archive has no deploy/install.sh. The display was not changed."
  fi
}

clone_sha() {
  local sha="$1"
  local dest="${HOME}/layr/src"
  local url="https://github.com/${GITHUB_REPO}.git"
  local got="" head=""
  export GIT_TERMINAL_PROMPT=0
  if [ -e "$dest" ] && [ ! -d "$dest/.git" ]; then
    die "${dest} exists and is not a LAYR checkout. It was not deleted. The display was not changed."
  fi
  if [ -d "$dest/.git" ]; then
    got=$(git -C "$dest" rev-parse HEAD 2>/dev/null || true)
    if [ "$got" = "$sha" ] && [ -f "$dest/dist/index.html" ]; then
      info "Reusing checkout ${sha}"
      return 0
    fi
  else
    mkdir -p "${HOME}/layr"
    git clone --origin origin "$url" "$dest" || die "git clone failed. The display was not changed."
  fi
  git -C "$dest" remote set-url origin "$url"
  git -C "$dest" fetch --depth 1 origin "$sha" || die "git fetch failed. The display was not changed."
  git -c advice.detachedHead=false -C "$dest" checkout --detach --force FETCH_HEAD || die "git checkout failed. The display was not changed."
  head=$(git -C "$dest" rev-parse HEAD)
  [ "$head" = "$sha" ] || die "Checkout is ${head}, not ${sha}. The display was not changed."
}

build_in_tree() {
  local node_dir="${HOME}/layr/toolchain/node"
  local spec url sha tarball tmp
  if [ -n "${LAYR_NODE_BIN:-}" ] && node_version_ok "$LAYR_NODE_BIN"; then
    PATH="$(dirname "$LAYR_NODE_BIN"):$PATH"
    export PATH
  elif [ -x "$node_dir/bin/node" ] && node_version_ok "$node_dir/bin/node"; then
    PATH="$node_dir/bin:$PATH"
    export PATH
  else
    spec=$(node_spec "$PLATFORM_ARCH") || die "No Node build for ${PLATFORM_ARCH}."
    url=$(printf '%s\n' "$spec" | sed -n '1p')
    sha=$(printf '%s\n' "$spec" | sed -n '2p')
    url_allowed "$url" || die "Refusing Node URL."
    tarball=$(mktemp)
    http_get "$url" "$tarball" 80000000 || die "Could not download Node. The display was not changed."
    if ! verify_sha256 "$tarball" "$sha"; then
      rm -f "$tarball"
      die "Node checksum did not match. The display was not changed."
    fi
    tmp="${HOME}/layr/toolchain/node.tmp"
    rm -rf "$tmp"
    mkdir -p "$tmp"
    tar -xzf "$tarball" -C "$tmp" --strip-components=1
    rm -f "$tarball"
    "$tmp/bin/node" -v >/dev/null
    rm -rf "$node_dir"
    mkdir -p "${HOME}/layr/toolchain"
    mv "$tmp" "$node_dir"
    PATH="$node_dir/bin:$PATH"
    export PATH
  fi
  hash -r
  cd "${HOME}/layr/src" || die "Could not enter the LAYR checkout. The display was not changed."
  npm ci || die "npm ci failed. The display was not changed."
  npm run build || die "npm run build failed. The display was not changed."
  cd "$SCRIPT_DIR" || die "Could not return to the installer directory."
  [ -f "${HOME}/layr/src/dist/index.html" ] || die "Build did not produce dist/index.html. The display was not changed."
}

install_layr() {
  local dist="$1"
  local script args
  if [ -n "${LAYR_INSTALL_SH:-}" ]; then
    script=$LAYR_INSTALL_SH
  elif [ "$SOURCE_MODE" = "release" ] && [ -n "${RELEASE_DEPLOY:-}" ] && [ -f "${RELEASE_DEPLOY}/install.sh" ]; then
    script="${RELEASE_DEPLOY}/install.sh"
  elif [ "$SOURCE_MODE" = "build" ] && [ -f "${HOME}/layr/src/deploy/install.sh" ]; then
    script="${HOME}/layr/src/deploy/install.sh"
  elif [ -f "${SCRIPT_DIR}/install.sh" ]; then
    script="${SCRIPT_DIR}/install.sh"
  else
    script="${HOME}/layr/src/deploy/install.sh"
  fi
  [ -f "$script" ] || die "install.sh is missing. The display was not changed."
  [ -f "$dist/index.html" ] || die "No index.html to install. The display was not changed."
  args=(--dist "$dist" --moonraker "$MOONRAKER" --port "$PORT" --yes)
  if [ "$DRY_RUN" = 1 ]; then
    args+=(--dry-run)
  fi
  if [ "$RELOAD_KIOSK" = 1 ]; then
    args+=(--reload-kiosk)
  fi
  bash "$script" "${args[@]}"
}

kiosk_already_active() {
  if [ -n "${LAYR_KIOSK_ACTIVE+x}" ]; then
    [ "$LAYR_KIOSK_ACTIVE" = 1 ]
    return
  fi
  systemctl is-active --quiet layr-kiosk.service 2>/dev/null
}

maybe_switch_display() {
  local display_sh body do_switch=0
  if [ "$SWITCH_KS" = 1 ]; then
    switch_to_klipperscreen || exit 1
    return 0
  fi
  if [ "${HOLD_DISPLAY:-0}" = 1 ] && [ "$SWITCH" != 1 ]; then
    printf 'display-switch: no\n'
    printf 'display-changed=no\n'
    printf 'The current display was left as it is.\n'
    return 0
  fi
  if kiosk_already_active; then
    printf 'display: LAYR kiosk is already active and was not restarted\n'
    printf 'display-changed=no\n'
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then
    if [ "$SWITCH" = 1 ]; then
      printf 'display-switch: planned after the page answers; not performed in a dry run\n'
    else
      printf 'display-switch: no\n'
    fi
    printf 'display-changed=no\n'
    return 0
  fi
  if [ "$SWITCH" = 1 ] && [ "$ASSUME_YES" = 1 ]; then
    do_switch=1
  elif [ "$SWITCH" = 1 ]; then
    if confirm_answer "Switch the touchscreen from KlipperScreen to LAYR now?"; then
      do_switch=1
    fi
  elif [ "$ASSUME_YES" != 1 ] && [ -t 0 ]; then
    if confirm_answer "Switch the touchscreen from KlipperScreen to LAYR now? No keeps KlipperScreen."; then
      do_switch=1
    fi
  fi
  if [ "$do_switch" != 1 ]; then
    printf 'display-switch: no\n'
    printf 'display-changed=no\n'
    printf 'KlipperScreen was left as it is. Open the preview URL in Chromium before switching.\n'
    return 0
  fi
  body=$(mktemp)
  if ! http_get "http://127.0.0.1:${PORT}/" "$body" 2000000 || [ ! -s "$body" ]; then
    rm -f "$body"
    printf 'Refusing to switch. The LAYR page did not answer. KlipperScreen was not stopped.\n'
    printf 'display-changed=no\n'
    print_recovery_bootstrap
    exit 1
  fi
  rm -f "$body"
  if [ -n "${LAYR_DISPLAY_SH:-}" ]; then
    display_sh=$LAYR_DISPLAY_SH
  elif [ -f "${SCRIPT_DIR}/layr-display.sh" ]; then
    display_sh="${SCRIPT_DIR}/layr-display.sh"
  else
    display_sh="${HOME}/layr/src/deploy/layr-display.sh"
  fi
  print_recovery_bootstrap
  if ! bash "$display_sh" to-layr --yes; then
    printf 'display-changed=no\n'
    printf 'The display switch failed. KlipperScreen should be back if it is installed.\n'
    print_recovery_bootstrap
    exit 1
  fi
  printf 'display-switch: layr-kiosk\n'
}

if [ "${LAYR_BOOTSTRAP_SOURCE_ONLY:-}" != 1 ]; then
  CALLER_PWD=$(pwd)
  SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
  SCRIPT_PATH="${SCRIPT_DIR}/$(basename "$0")"
  require_complete_script "$SCRIPT_PATH"
  cd "$SCRIPT_DIR" || exit 1
  bootstrap_main "$@"
fi
# LAYR_SCRIPT_END
