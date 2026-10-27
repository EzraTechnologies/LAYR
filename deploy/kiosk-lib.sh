#!/usr/bin/env bash
# Shared kiosk helpers. Sourced by layr-kiosk.sh and layr-engine.sh. Not executed directly.
# shellcheck disable=SC2034

# Prints `chromium` or `wpe`. Returns 1 for anything else.
normalize_engine() {
  local raw
  raw=$(printf '%s' "${1:-chromium}" | tr '[:upper:]' '[:lower:]')
  case "$raw" in
    '' | chromium | chrome) printf 'chromium\n' ;;
    wpe | cog) printf 'wpe\n' ;;
    *) return 1 ;;
  esac
}

# Directory list override: LAYR_COG_MODULE_DIRS (space or newline separated).
# Prints `wl` or `fdo` when that Cog platform plugin is installed.
# The DRM/KMS plugin is intentionally ignored: on some Pi 4 boards it never shows a frame,
# and it would take the display away from Cage.
find_cog_wayland_platform() {
  local dir name list
  list="${LAYR_COG_MODULE_DIRS:-}"
  if [ -z "$list" ]; then
    list=$(ls -d /usr/lib/*/cog/modules /usr/lib/cog/modules 2>/dev/null || true)
  fi
  # shellcheck disable=SC2086
  for dir in $list; do
    for name in wl fdo; do
      if [ -f "$dir/libcogplatform-${name}.so" ]; then
        printf '%s\n' "$name"
        return 0
      fi
    done
  done
  return 1
}

# Human-readable dependency report. Exit 0 only when Cog and a Wayland platform plugin exist.
# Does not install or upgrade anything. WebKitGTK is a different engine and is not accepted.
wpe_report() {
  local ok=0 platform
  if command -v cog >/dev/null 2>&1; then
    printf 'cog: %s\n' "$(command -v cog)"
    if cog --version >/dev/null 2>&1; then
      printf 'cog-version: %s\n' "$(cog --version 2>/dev/null | head -n 1)"
    fi
  else
    printf 'cog: not installed\n'
    printf 'install-hint: Debian Bookworm package is cog (0.16.1), which depends on libwpewebkit-1.1-0. LAYR does not install it.\n'
    ok=1
  fi
  if platform=$(find_cog_wayland_platform); then
    printf 'wayland-platform: %s\n' "$platform"
  else
    printf 'wayland-platform: missing (libcogplatform-wl.so or libcogplatform-fdo.so)\n'
    printf 'drm-platform: not used. Direct Cog DRM/KMS is a separate plugin and is not launched.\n'
    ok=1
  fi
  if ! command -v cage >/dev/null 2>&1; then
    printf 'cage: not installed (WPE is started inside Cage, the same compositor as Chromium)\n'
    ok=1
  else
    printf 'cage: %s\n' "$(command -v cage)"
  fi
  if command -v dpkg >/dev/null 2>&1; then
    if dpkg-query -W -f '${Package} ${Version}\n' libwpewebkit-1.1-0 >/dev/null 2>&1; then
      printf 'libwpewebkit: %s\n' "$(dpkg-query -W -f '${Package} ${Version}' libwpewebkit-1.1-0 2>/dev/null || true)"
    else
      printf 'libwpewebkit: libwpewebkit-1.1-0 is not installed\n'
      ok=1
    fi
    if dpkg-query -W -f '${Package}\n' 'libwebkit2gtk*' 2>/dev/null | grep -q .; then
      printf 'note: WebKitGTK is a different port from WPE WebKit. LAYR does not launch it.\n'
    fi
    printf 'security: Debian Bookworm does not provide security updates for wpewebkit. Do not upgrade it from another suite.\n'
  fi
  return "$ok"
}

# Engine that should actually be exec'd. WPE falls back to Chromium, with a message on stderr,
# when cog or its Wayland plugin is missing. The saved LAYR_KIOSK_ENGINE value is not changed.
resolve_launch_engine() {
  local requested
  if ! requested=$(normalize_engine "${LAYR_KIOSK_ENGINE:-chromium}"); then
    printf 'LAYR_KIOSK_ENGINE=%s is not chromium or wpe. Starting Chromium.\n' "${LAYR_KIOSK_ENGINE-}" >&2
    printf 'chromium\n'
    return 0
  fi
  if [ "$requested" = "chromium" ]; then
    printf 'chromium\n'
    return 0
  fi
  if wpe_report >/dev/null; then
    printf 'wpe\n'
    return 0
  fi
  printf 'WPE was requested but is not usable. Starting Chromium for this session. The saved engine is still wpe. Run layr-engine.sh use chromium to save the rollback.\n' >&2
  printf 'chromium\n'
}

# Prints 1 when the kiosk should hide the compositor cursor, else 0.
# LAYR_HIDE_CURSOR=0 or 1 wins. Otherwise the Chromium profile's layr.ui setting is read.
# Unknown or unreadable settings stay visible so a physical mouse is not hidden by accident.
read_hide_cursor() {
  case "${LAYR_HIDE_CURSOR:-}" in
    1 | true | yes | on) printf '1\n'; return 0 ;;
    0 | false | no | off) printf '0\n'; return 0 ;;
  esac
  local profile="${LAYR_PROFILE:-${HOME:-/tmp}/.config/layr-chromium}"
  local reader dir bit
  dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  reader="$dir/read-hide-cursor.py"
  if [ ! -f "$reader" ]; then
    printf '0\n'
    return 0
  fi
  bit=$(python3 "$reader" "$profile" 2>/dev/null || printf '0')
  case "$bit" in
    1) printf '1\n' ;;
    *) printf '0\n' ;;
  esac
}
