#!/usr/bin/env bash
# One-command LAYR install for a Raspberry Pi that already runs Klipper and Moonraker.
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
#   bash deploy/bootstrap.sh diagnose
#   bash deploy/bootstrap.sh --preflight
#   bash deploy/bootstrap.sh --dry-run --yes
#   bash deploy/bootstrap.sh --yes
#   bash deploy/bootstrap.sh --yes --switch-display
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
A text console is Ctrl+Alt+F1, or: sudo chvt 1
EOF
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

usage() {
  cat <<'EOF'
Usage: bash deploy/bootstrap.sh [diagnose] [--preflight] [--dry-run] [--yes]
                                [--switch-display] [--moonraker URL] [--port N]
                                [--dist DIR] [--ref NAME] [--sample-touch]

Installs LAYR in preview mode. KlipperScreen stays as it is until you confirm
a display switch (or pass both --yes and --switch-display). The Pi is not rebooted.
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

  if [ -n "$DIST_ARG" ]; then
    case "$DIST_ARG" in
      /*) DIST_PATH=$DIST_ARG ;;
      *) DIST_PATH="${CALLER_PWD}/${DIST_ARG}" ;;
    esac
    if [ -d "$DIST_PATH" ]; then
      DIST_PATH=$(cd "$DIST_PATH" && pwd)
    fi
    if [ ! -f "$DIST_PATH/index.html" ]; then
      fail_preflight "No index.html in ${DIST_PATH}. Nothing was changed."
    fi
  else
    DIST_PATH=""
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
  if [ -e "${LAYR_HOME_OVERRIDE:-$HOME/layr}/current" ]; then
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
