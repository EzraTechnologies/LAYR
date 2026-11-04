# Mecer BT26: first physical test

Status: **manual Cage + Chromium X11/XWayland touchscreen operation physically
validated by the owner; systemd kiosk/automatic startup remains unverified**.
The tested BT26 runs Debian 12 i386, Cage 0.1.4 and Chromium 156, with an ELAN
ELAN1001:00 04F3:2029 touchscreen. Native Chromium Wayland rendered LAYR but touch
failed. Use [the current in-place X11 upgrade guide](bt26-x11-upgrade.md) for the
existing tablet; the first-install steps below are historical preparation. A
working manual launch does not resolve the separate logind/VT activation denial.
No updated review bundle has been uploaded. Hardware compatibility beyond the
reported manual rendering/touch result is not certified.

Do everything below on the tablet unless a step explicitly says build workstation.
No command logs into, installs on, restarts or reconfigures the Raspberry Pi.
Moonraker checks use read-only HTTP GET requests to the printer's API. Use a test
printer profile and avoid motion/heater controls during initial UI validation.

## Minimal Debian privilege setup (before installation)

The first physical test exposed a missing-sudo preflight defect. The local fix
now validates sudo and actual UID 0 escalation before installation/profile prompts,
APT, service changes or recovery actions. It does not assume membership in the
sudo group. **The previously uploaded test bundle does not yet contain this fix;
no updated bundle has been pushed.**

Run `whoami` as your normal tablet user and note that username. Check:

```bash
command -v sudo
sudo -v
sudo -n -- id -u
```

The final command must print `0`. If sudo is missing or the account lacks access,
use the Debian root password to enter a root login shell. In the following root
commands replace `YOUR_TABLET_USERNAME` with the normal username noted above:

```bash
su -
apt-get update
apt-get install sudo
usermod -aG sudo YOUR_TABLET_USERNAME
exit
```

`su -` asks for the **root password**, not the tablet user's password. Log out
completely (including SSH sessions), then log back in as the normal tablet user.
Repeat `sudo -v` and `sudo -n -- id -u`. Do not proceed until they succeed. An
administrator may instead grant appropriate sudoers access; group membership is
not itself proof of authorization. If the root password is unavailable or the
root account is locked, have an administrator use the tablet's local recovery
procedure. The installer cannot safely grant itself administrator access.

Run LAYR as the normal user. **Do not run `sudo python3 deploy/layr`, and do not
install from the `su -` root shell**: application files and systemd service User=
must remain owned by the normal user. Root is used only for the prerequisite
setup above and individual validated sudo operations.

Interactive installation over SSH needs a terminal (`ssh -t` if necessary) for
sudo authentication. `--yes` and non-terminal runs never request a password;
authenticate with `sudo -v` in the same terminal first, or have an administrator
configure suitable NOPASSWD access for non-interactive automation. Authorization
failures stop before installation changes, even for `--dry-run`/`preflight`.
Read-only `layr status`/`diagnose` remain available without sudo. Local connection
and cursor settings do not need elevation. Standalone shell dry runs retain their
existing preview-only behavior and do not require sudo.

The same privilege validation protects install, update, repair, start/stop/restart,
display switching, rollback, uninstall and recovery. Cached credentials may expire;
any later sudo policy/authentication denial is still a failure, not a successful
installation. Command-restricted sudoers policies must also permit the actual
APT, unit installation and service operations, not just the validation probe.

## Prepare the reviewed files on the build workstation

The current fixes have not been pushed or published; the older GitHub test
bundle is stale and there is no updated download URL for these changes. Do not download main's bootstrap and expect this reviewed installer.
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
python3 deploy/layr preflight --profile kiosk --chromium-backend x11 --moonraker "$moon_url" --dist ./dist
```

Stop on any preflight failure. An active desktop manager means use the desktop
profile and its browser for the first preview, or prepare a separate dedicated
console image. The installer will not stop the desktop to force kiosk mode.
No connected DRM display, missing tty7/DRM device, failed package candidate or
failed dependency simulation needs investigation. Do not substitute ARM packages,
change Debian suites, or install a different browser merely to bypass a failure.

Then, only on this tablet:

```bash
python3 deploy/layr install --profile kiosk --chromium-backend x11 --dist ./dist
```

Confirm the detected profile, enter the remote hostname/IP and port, and retain
X11 for this BT26. Kiosk boot startup remains disabled until the separate
service-based preview and physical confirmation succeed. For unattended tablet provisioning the
corresponding command is:

```bash
python3 deploy/layr install --profile kiosk --chromium-backend x11 --moonraker "$moon_url" --dist ./dist --yes
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
layr switch layr             # explicit temporary preview; boot remains disabled
# Only after the real UI is visible and input has been tested:
layr enable-kiosk            # interactive physical confirmation
layr configure              # change/test Moonraker without reinstalling
layr restart                # applies connection/cursor changes to an active kiosk
```

Use the printed preview URL, including its Moonraker query, in the tablet browser.
Confirm remote printer identity, browser CORS/WebSocket connection, all screen
corners, touch accuracy, scrolling, keyboard input and graphics. Record Chromium
version, Cage version, `lspci -nnk` if available, kernel, and libinput inventory.
For Wi-Fi: drop and restore only the tablet's connection and check recovery.
Only after successful preview and `layr enable-kiosk`, with SSH recovery ready,
cold-boot **the tablet** and verify Wi-Fi, enabled units,
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

## Flashing-cursor follow-up

A later physical test reached local web service and remote Moonraker, but the
kiosk showed a flashing underscore and touch remained unverified. Follow the
[blank-screen evidence and in-place upgrade procedure](bt26-blank-screen.md).
The current local CLI offers a persistent menu, readable status, temporary kiosk
preview and explicit physical confirmation before boot startup. Older uploaded
bundles do not contain those changes. The confirmed seat errors motivated a dedicated local logind session and bounded
renderer supervisor; no GPU workaround has been introduced. Physical retest remains
required.


## Confirmed manual touch follow-up

Use `--chromium-backend x11` for BT26 kiosk preflight/install. Fresh interactive
Intel kiosk setup recommends X11; Wayland can be selected, and an existing saved
value is preserved unless explicitly changed. In the management menu, Display
and touchscreen offers both backends and Back navigation. The menu returns after
operations. `layr backend --chromium-backend x11` checks/installs XWayland without
changing browser profile, Moonraker or web releases. See
[bt26-x11-upgrade.md](bt26-x11-upgrade.md) for exact commands and service-only
physical confirmation, recovery and outstanding diagnostic evidence.


## Native photo-picker limitation

The BT26 owner subsequently reported that native Linux photo selection does not
respond to touch, despite working Cage/X11 web input. Use the reviewed updated
app's in-page bundled illustration chooser; native upload remains behind an
explicit button with a keyboard/mouse warning. Do not reopen the old picker on a
touch-only setup. See [touchscreen-file-picker.md](touchscreen-file-picker.md) for
physical verification, cancellation/recovery and read-only toolkit diagnostics.
The fallback has not yet been physically retested or published.
# Optional display-power follow-up

The new Intel display-power component remains disabled until explicitly enabled.
The previously published `0.2.0-20261104.1` combined archive does not include it. See
[display-power.md](display-power.md) for the reviewed in-place update procedure,
five-minute idle/four-minute dim test, power-button and SSH wake checks, crash
restoration and disable/rollback instructions. The owner's successful kernel
backlight/button tests do not validate the new service sandbox or automatic
startup. Validate a working service-based kiosk preview before enabling it.
