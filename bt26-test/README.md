# BT26 installer test bundle

This branch is a supervised test handoff, not a release. Main and the existing
Raspberry Pi installation were not changed. The bundle contains reviewed installer
scripts, prebuilt web assets and guides. No Node.js, Klipper, Moonraker or
KlipperScreen installation is required on the tablet.

Hardware compatibility is unverified. Keep a tablet image backup, USB keyboard
and a working second SSH connection available before activating the kiosk.
Rotation and touchscreen calibration are not implemented by this CLI.

## Download directly on the Debian 12 tablet

Run these commands on the tablet, as its normal user (not root). If curl is not
installed, install the prerequisites first:

```bash
sudo apt-get update
sudo apt-get install -y --no-remove python3 curl ca-certificates
```

Then download and verify before extracting:

```bash
set -e
mkdir -p "$HOME/layr-bt26-review"
cd "$HOME/layr-bt26-review"
curl -fL --proto '=https' \
  https://raw.githubusercontent.com/EzraTechnologies/LAYR/bt26-installer-test/bt26-test/layr-bt26-review.tar.gz \
  -o layr-bt26-review.tar.gz
printf '%s  %s\n' \
  3d1ceaa57d0e952899293ce3494d74db166e90105602b5b0e18095d7d73e03d6 \
  layr-bt26-review.tar.gz | sha256sum -c -
tar -xzf layr-bt26-review.tar.gz
python3 deploy/layr diagnose
python3 deploy/layr preflight --profile kiosk --dist ./dist
```

Enter the remote printer's Moonraker IP/hostname and port when prompted, normally
port 7125. Do not select localhost for this remote-only tablet. Preflight is
read-only. Stop and investigate any failure; do not bypass missing graphics,
unsupported packages or an active desktop manager.

After preflight succeeds, begin the interactive tablet installation:

```bash
python3 deploy/layr install --profile kiosk --dist ./dist
layr
```

The installer asks again for Moonraker because preflight saved nothing. Initially
answer No to automatic startup, inspect the preview, then activate explicitly:

```bash
layr switch layr --yes
layr status
journalctl -u layr-web -u layr-kiosk -b -n 100 --no-pager
```

## Recovery on the tablet

```bash
layr recover
sudo chvt 1
layr uninstall --yes
```

If the global command is broken:

```bash
python3 "$HOME/layr/management/layr" recover
bash "$HOME/layr/management/uninstall.sh" --yes
```

Uninstall keeps user data and packages. Web rollback (`layr rollback --yes`)
requires a previous installation and does not reverse OS or installer changes.

## Full guide and validation

See [the hardware test guide](../docs/mecer-bt26-test.md),
[review findings](../docs/installer-review.md),
[validation results](../docs/installer-validation.md) and
[compatibility matrix](../docs/compatibility.md).

The software validation recorded 35 installer tests and 393 unit tests passing.
Initial browser failures passed isolated retries; clean full browser CI remains
necessary before a release. No real tablet validation has occurred.
