# LAYR v1.0.0

The first numbered public release of LAYR, a free, GPLv3, touch-first interface for Klipper and Moonraker.

## Highlights

- Raspberry Pi Chromium kiosk for HDMI touch displays, including BTT HDMI7 at 1024×600 and common 800×480 panels.
- Live print dashboard, print controls, thumbnails, G-code files, motion, heaters, fans, macros and console.
- Optional Spoolman integration and optional AFC or Happy Hare views when supported by the connected printer.
- Confirmations and state checks before printer-changing actions.
- Standalone installer, display switcher, diagnostics, update/repair and rollback tools.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/EzraTechnologies/LAYR/main/deploy/layr-installer.sh -o /tmp/layr-installer.sh
bash /tmp/layr-installer.sh
```

The installer selects this signed-off release bundle when it is published, verifies `layr-dist.tar.gz.sha256` and installs the prebuilt web files. KlipperScreen remains installed and is not switched off without confirmation.

## Requirements and limitations

- Raspberry Pi OS Bookworm or MainsailOS Bookworm, on supported Raspberry Pi ARM hardware.
- Existing working Klipper and Moonraker installations.
- The installer does not install Klipper, Moonraker, AFC, Happy Hare or Spoolman.
- Pi hardware testing has focused on the Voron Trident with Raspberry Pi 4 and 7-inch BTT HDMI display. Other hardware and native Qt paths need additional testing.
- This release is not a claim that every optional hardware configuration has been tested.

## Release assets

- `layr-dist.tar.gz` — prebuilt web application and deployment scripts
- `layr-dist.tar.gz.sha256` — SHA-256 checksum; installer verifies it before installing

## Open source

LAYR is free and open source under the GNU General Public License v3.0. Contributions and bug reports are welcome.
