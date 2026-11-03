> Download this reviewed bundle directly on the tablet using [these instructions](../bt26-test/README.md). The workstation/SCP sections below are the historical preparation route.

# Mecer BT26: first physical test

Status: **unverified hardware; supervised first-test candidate only**.
Installer and unit gates pass. Initial browser failures passed isolated retries;
a clean full browser CI run is still needed before release. Use backups and
SSH/keyboard recovery for the supervised tablet test below. No tablet has been
connected or changed. Target details supplied by the owner: Mecer/Mustek BT26,
Intel Atom Z3775D, 2 GB RAM, Debian 12 Bookworm i386, Wi-Fi, no local Klipper,
Moonraker or KlipperScreen. Verify these details on the actual device. Firmware
bitness and CPU bitness do not establish userspace architecture; use dpkg.

Do everything below on the tablet unless a step explicitly says build workstation.
No command logs into, installs on, restarts or reconfigures the Raspberry Pi.
Moonraker checks use read-only HTTP GET requests to the printer's API. Use a test
printer profile and avoid motion/heater controls during initial UI validation.

## Prepare the reviewed files on the build workstation

Nothing has been pushed or published, so there is no public download URL for
these changes. Do not download main's bootstrap and expect this reviewed installer.
On a workstation that has this exact working tree and the required Node >=22.12:

```bash
cd /workspace/LAYR
npm run verify
npm run test:installer
mkdir -p work
# Package local reviewed files; this creates no release or deployment.
tar --exclude='__pycache__' --exclude='*.pyc' -czf work/layr-bt26-review.tar.gz deploy dist docs
sha256sum work/layr-bt26-review.tar.gz
```

Keep the printed hash via a separate trusted channel. Transfer the archive from
a reachable build workstation using SCP; neither Node nor npm runs on the tablet.

## Tablet preparation and installer download

Start from a backed-up tablet image. Confirm working Wi-Fi, SSH from a second
machine, a USB keyboard, and Ctrl+Alt+F1 recovery before trying a kiosk. Keep the
second SSH connection open during display tests. Record the existing desktop and
KlipperScreen state; do not remove either to get past preflight.

```bash
set -e
uname -a
dpkg --print-architecture
cat /etc/os-release
free -m
df -h "$HOME"
systemctl is-active display-manager.service KlipperScreen.service || true
loginctl list-sessions
# Tablet prerequisites only; this is not the installer's read-only preflight.
sudo apt-get update
sudo apt-get install -y --no-remove python3 curl ca-certificates openssh-client
mkdir -p "$HOME/layr-bt26-review"
cd "$HOME/layr-bt26-review"
read -r -p 'SCP source (user@BUILD_HOST:/full/path/layr-bt26-review.tar.gz): ' bundle_source
scp "$bundle_source" ./layr-bt26-review.tar.gz
read -r -p 'Expected SHA256 from build workstation: ' bundle_sha
printf '%s  %s\n' "$bundle_sha" layr-bt26-review.tar.gz | sha256sum -c -
# Stop if checksum verification fails. Inspect before extracting.
tar -tzf layr-bt26-review.tar.gz | head -30
tar -xzf layr-bt26-review.tar.gz
```

If a reviewed bundle is supplied at an approved HTTPS URL instead of SCP, replace
only the SCP command with `curl -fL --proto '=https' "$BUNDLE_URL" -o layr-bt26-review.tar.gz`
and still verify its separately supplied checksum. No URL has been published by
this task.

## Read-only preflight, then interactive install

```bash
cd "$HOME/layr-bt26-review"
python3 deploy/layr diagnose
read -r -p 'Remote Moonraker IP or hostname: ' moon_host
read -r -p 'Moonraker port [7125]: ' moon_port
moon_port=${moon_port:-7125}
moon_url="http://${moon_host}:${moon_port}"
python3 deploy/layr preflight --profile kiosk --moonraker "$moon_url" --dist ./dist
```

Stop on any preflight failure. An active desktop manager means use the desktop
profile and its browser for the first preview, or prepare a separate dedicated
console image. The installer will not stop the desktop to force kiosk mode.
No connected DRM display, missing tty7/DRM device, failed package candidate or
failed dependency simulation needs investigation. Do not substitute ARM packages,
change Debian suites, or install a different browser merely to bypass a failure.

Then, only on this tablet:

```bash
python3 deploy/layr install --profile kiosk --dist ./dist
```

Confirm the detected profile, enter the remote hostname/IP and port, and answer
the automatic startup question. Prefer **No** for the first install, validate the
page and touch, then activate explicitly. For unattended tablet provisioning the
corresponding command is:

```bash
python3 deploy/layr install --profile kiosk --moonraker "$moon_url" --dist ./dist --autostart --yes
```

`--allow-offline` permits explicit offline staging; it is not a successful
connectivity check. Local Klipper, Moonraker and KlipperScreen are never required
or installed. No printer configuration or Wi-Fi configuration is written.

## Management and observations

```bash
command -v layr
ls -l /usr/local/bin/layr
test -x /usr/local/bin/layr
layr                         # terminal menu; 0 exits
layr status
layr display
sudo libinput list-devices
sudo timeout 15s libinput debug-events  # exit 124 is normal timeout
systemctl status layr-web.service layr-kiosk.service --no-pager || true
systemctl is-enabled layr-web.service layr-kiosk.service || true
journalctl -u layr-web -u layr-kiosk -b -n 100 --no-pager
layr switch layr --yes       # explicit display activation + boot enablement
layr configure              # change/test Moonraker without reinstalling
layr restart                # applies connection/cursor changes to an active kiosk
```

Use the printed preview URL, including its Moonraker query, in the tablet browser.
Confirm remote printer identity, browser CORS/WebSocket connection, all screen
corners, touch accuracy, scrolling, keyboard input and graphics. Record Chromium
version, Cage version, `lspci -nnk` if available, kernel, and libinput inventory.
For Wi-Fi: drop and restore only the tablet's connection and check recovery.
With SSH recovery ready, cold-boot **the tablet** and verify Wi-Fi, enabled units,
actual visible rendering and touch. Verify suspend/resume separately. Rotation or
calibration beyond the default orientation remains unsupported by the CLI and
must be recorded as a blocking device issue if needed.

Do not count an active service or a detected touch device as a hardware pass.
Check repeat installation from the same bundle, upgrade using a distinct reviewed
build, web rollback and recovery. Keep each result and log with the matrix entry.

## Stop, recovery, rollback and uninstall (tablet only)

```bash
layr stop                   # temporary; does not disable next-boot startup
layr start                  # web + previously enabled kiosk; first activation uses switch layr
layr recover                # stop and disable only the LAYR kiosk
sudo chvt 1
layr rollback --yes          # previous web assets only; requires a previous install
layr repair --allow-offline --yes
layr uninstall --yes         # remove units/global command, keep user data
hash -r
command -v layr || true      # should be absent; investigate another PATH entry
```

If the global command is broken, use
`python3 "$HOME/layr/management/layr" recover` or
`bash "$HOME/layr/management/uninstall.sh" --yes`.
No KlipperScreen switch is offered on this target unless it has subsequently been
installed independently. No packages are purged. Installer/service/OS rollback
requires the pre-test backup; web rollback alone is not that backup.
