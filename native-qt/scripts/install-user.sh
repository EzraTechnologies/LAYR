#!/bin/sh
# Opt-in copy of this prototype into ~/layr-qt.
# Refuses to run unless you pass --yes. Does not touch the active display stack.
set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the printer user, not root." >&2
  exit 1
fi

yes=0
with_unit=0
for arg in "$@"; do
  case $arg in
    --yes) yes=1 ;;
    --with-user-unit) with_unit=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 --yes [--with-user-unit]" >&2
      exit 1
      ;;
  esac
done

if [ "$yes" -ne 1 ]; then
  echo "This installer does nothing without --yes." >&2
  echo "It copies native-qt to ~/layr-qt. It does not switch away from Chromium or KlipperScreen." >&2
  exit 1
fi

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dest=$HOME/layr-qt
mkdir -p "$dest"
# Copy the prototype. Do not follow this with a systemctl stop of any display service.
tar -C "$root" -cf - \
  --exclude '__pycache__' \
  --exclude 'docs/screenshots' \
  layr_qt qml tests scripts check-deps.sh layr-qt layr-qt.env.example README.md docs \
  | tar -C "$dest" -xf -
chmod +x "$dest/layr-qt" "$dest/check-deps.sh" "$dest/scripts/"*.sh

if [ "$with_unit" -eq 1 ]; then
  mkdir -p "$HOME/.config/systemd/user"
  unit=$HOME/.config/systemd/user/layr-qt.service
  cat > "$unit" << EOF
# LAYR_QT_UNIT_MARKER
# Not enabled by this installer. Start it yourself if you want a user service.
# It does not conflict with layr-kiosk.service or KlipperScreen on purpose:
# the default platform is VNC, which does not take the HDMI device.
[Unit]
Description=LAYR native Qt prototype (read-only, VNC)
[Service]
Type=simple
WorkingDirectory=$dest
Environment=LAYR_QT_PLATFORM=vnc
ExecStart=$dest/scripts/launch-session.sh
Restart=on-failure
[Install]
WantedBy=
EOF
  echo "Wrote $unit and left it disabled."
  echo "It will not start at login. systemctl --user start layr-qt.service is manual."
fi

echo "Installed to $dest"
echo "Try:  $dest/check-deps.sh"
echo "Then: $dest/scripts/launch-session.sh"
echo "Stop: $dest/scripts/rollback-session.sh"
echo "The running Svelte/Chromium UI was not modified."
