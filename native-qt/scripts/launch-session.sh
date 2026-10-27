#!/bin/sh
# One foreground native Qt session.
# Does not stop, start, or restart layr-kiosk, layr-web, Klipper, Moonraker, or KlipperScreen.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

env_file=""
if [ -n "${LAYR_QT_ENV_FILE:-}" ] && [ -f "$LAYR_QT_ENV_FILE" ]; then
  env_file=$LAYR_QT_ENV_FILE
elif [ -f "$HOME/.config/layr-qt/layr-qt.env" ]; then
  env_file=$HOME/.config/layr-qt/layr-qt.env
elif [ -f "$root/layr-qt.env" ]; then
  env_file=$root/layr-qt.env
fi
if [ -n "$env_file" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$env_file"
  set +a
fi

platform=${LAYR_QT_PLATFORM:-vnc}
size=${LAYR_QT_SIZE:-1024x600}
port=${LAYR_QT_VNC_PORT:-5900}

case $platform in
  eglfs|linuxfb)
    if [ "${LAYR_QT_ALLOW_KMS:-0}" != "1" ]; then
      echo "Refusing platform '$platform' without LAYR_QT_ALLOW_KMS=1." >&2
      echo "Those plugins take the DRM/KMS display and can blank the panel that Chromium or KlipperScreen is using." >&2
      echo "Use LAYR_QT_PLATFORM=vnc to look at the UI without touching HDMI." >&2
      exit 1
    fi
    echo "WARNING: $platform will try to become DRM master. If another UI owns the HDMI output, this can fail or blank it." >&2
    echo "This script still does not stop that other UI. Ctrl+C returns you to the shell." >&2
    export QT_QPA_EGLFS_HIDECURSOR=1
    ;;
  vnc|xcb|wayland|offscreen)
    ;;
  *)
    echo "Unknown LAYR_QT_PLATFORM=$platform" >&2
    exit 1
    ;;
esac

state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/layr-qt
mkdir -p "$state_dir"
pid_file=$state_dir/session.pid
if [ -f "$pid_file" ]; then
  old=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    echo "A layr-qt session is already recorded as pid $old. Leave it, or run scripts/rollback-session.sh" >&2
    exit 1
  fi
fi

export QT_ENABLE_HIGHDPI_SCALING=${QT_ENABLE_HIGHDPI_SCALING:-0}
export QT_QUICK_CONTROLS_STYLE=${QT_QUICK_CONTROLS_STYLE:-Basic}
if [ "$platform" = "vnc" ]; then
  export QT_QPA_PLATFORM="vnc:size=${size}:port=${port}"
  echo "VNC framebuffer ${size} on port ${port}. From your workstation: ssh -L ${port}:127.0.0.1:${port} <pi>"
  echo "Then open a VNC client on 127.0.0.1:${port}. The HDMI panel is not switched."
else
  export QT_QPA_PLATFORM=$platform
fi

echo "Starting one read-only LAYR Qt session (platform=$platform). Ctrl+C stops only this process."
if [ -n "${LAYR_QT_MOONRAKER_URL:-}" ]; then
  python3 -m layr_qt --size "$size" --moonraker "$LAYR_QT_MOONRAKER_URL" &
else
  python3 -m layr_qt --size "$size" &
fi
child=$!
echo "$child" > "$pid_file"
status=0
wait "$child" || status=$?
rm -f "$pid_file"
exit "$status"
