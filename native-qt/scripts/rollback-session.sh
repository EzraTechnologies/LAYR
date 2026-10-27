#!/bin/sh
# Stop the native Qt session this tree started.
# Does not enable, disable, or restart layr-web, layr-kiosk, KlipperScreen, Klipper, or Moonraker.
set -eu

state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/layr-qt
pid_file=$state_dir/session.pid
unit_name=layr-qt.service

if [ -f "$pid_file" ]; then
  pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case $cmd in
      *layr_qt*|*layr-qt*)
        echo "Stopping layr-qt pid $pid"
        kill "$pid" 2>/dev/null || true
        ;;
      *)
        echo "Pid $pid is not layr-qt ($cmd). Not killing it." >&2
        ;;
    esac
  fi
  rm -f "$pid_file"
else
  echo "No session pid file. Nothing from launch-session.sh is recorded."
fi

if [ "${1:-}" = "--purge" ]; then
  if [ -d "$HOME/layr-qt" ]; then
    echo "Removing $HOME/layr-qt"
    rm -rf "$HOME/layr-qt"
  fi
  unit=$HOME/.config/systemd/user/$unit_name
  if [ -f "$unit" ] && grep -q LAYR_QT_UNIT_MARKER "$unit"; then
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user disable --now "$unit_name" >/dev/null 2>&1 || true
    fi
    rm -f "$unit"
    echo "Removed the optional user unit $unit_name"
  fi
fi

echo "Chromium, layr-kiosk, layr-web, and KlipperScreen were not changed."
