# Mecer BT26 Beta 2 — 0.2.0-20261104.2

Use this guide for the existing **tablet**, as its normal LAYR owner (`karel`),
on Debian 12 i386. Do not run it on the Raspberry Pi or printer host. Keep two
SSH connections and a keyboard available. No Debian reinstallation or Node.js is
required. Run blocks in order and stop on errors. Commands assume `~/layr`; adapt
all paths consistently if the existing installation uses a different root.

This build contains the shared universal installer, X11/XWayland backend,
persistent CLI menus, touch-friendly illustration chooser and optional Intel
display power. Manual BT26 X11 touch and kernel backlight/button APIs are
owner-validated; **service-based kiosk startup, the new controller/sandbox and
cold-boot persistence remain physically unverified**. Raspberry Pi retains native
Wayland defaults and cannot enable Intel display power.

## Download and verify

Actual release/asset locations (private repository authentication is required):

- https://github.com/EzraTechnologies/LAYR/releases/tag/v0.2.0-20261104.2-bt26
- https://github.com/EzraTechnologies/LAYR/releases/download/v0.2.0-20261104.2-bt26/layr-bt26-test-0.2.0-20261104.2.tar.gz
- https://github.com/EzraTechnologies/LAYR/releases/download/v0.2.0-20261104.2-bt26/layr-bt26-test-0.2.0-20261104.2.tar.gz.sha256

An unauthenticated `curl` to a private asset can return 404. Use GitHub CLI with
your authorized account, or download both assets in an authenticated browser on
your computer and SCP them to the tablet. Do not embed a token in a URL/command.
If needed, install `gh` using `sudo apt-get install gh` and authenticate with
`gh auth login --hostname github.com --web`; never give LAYR your GitHub token.

```bash
(
set -e
mkdir "$HOME/layr-bt26-beta-2-download"
cd "$HOME/layr-bt26-beta-2-download"
gh release download v0.2.0-20261104.2-bt26 --repo EzraTechnologies/LAYR \
  --pattern layr-bt26-test-0.2.0-20261104.2.tar.gz \
  --pattern layr-bt26-test-0.2.0-20261104.2.tar.gz.sha256
sha256sum -c layr-bt26-test-0.2.0-20261104.2.tar.gz.sha256
mkdir -p "$HOME/layr-test-builds"
test ! -e "$HOME/layr-test-builds/layr-bt26-test-0.2.0-20261104.2"
tar -xzf layr-bt26-test-0.2.0-20261104.2.tar.gz -C "$HOME/layr-test-builds"
cd "$HOME/layr-test-builds/layr-bt26-test-0.2.0-20261104.2"
sha256sum -c SHA256SUMS
cmp deploy/bt26-build.json dist/bt26-build.json
cat BUILD.json
)
```

Compare the external checksum with the published checksum in the publication
report as well. Never overlay an older extraction or use the source-only GitHub
zip as the prebuilt installer. If downloading on another computer, transfer both
files with `scp FILE FILE.sha256 karel@TABLET_IP:~/`; TABLET_IP is the tablet, not
the remote Moonraker address. Then run verification/extraction from that directory.

## Stop the old kiosk and back up

Close any manually launched Cage/Chromium in its original console before backing
up browser storage. Do not kill unrelated sessions, clear profile locks, change
the browser profile, or use a new web port. Confirm the working manual profile
matches saved `LAYR_PROFILE` (default `~/.config/layr-chromium`). The closed profile
backup below includes IndexedDB, saved images, printer profiles and localStorage.
Ensure enough space for the entire existing installation and browser backup;
use external backup storage if needed. The backup directory must be new.

If sudo is missing, stop here: follow the one-time administrator setup in
`docs/mecer-bt26-test.md`. Run the installer as the normal owner, never root.

```bash
(
set -e
sudo -v
if [ -f /usr/local/lib/layr-display-power/controller.py ]; then
  layr display-power disable --yes
fi
sudo systemctl disable layr-kiosk.service
if ! timeout 15s sudo systemctl stop layr-kiosk.service; then
  sudo systemctl kill --kill-whom=all --signal=SIGKILL layr-kiosk.service
fi
if systemctl is-active --quiet layr-kiosk.service; then
  echo 'Stop: kiosk is still active; collect its journal.' >&2
  exit 1
fi
sudo systemctl reset-failed layr-kiosk.service
sudo chvt 1
umask 077
bt26_backup="$HOME/layr-bt26-before-0.2.0-20261104.2"
mkdir "$bt26_backup"
sudo journalctl -b -u layr-kiosk.service -n 250 --no-pager > "$bt26_backup/kiosk-before.log"
tar -czf "$bt26_backup/layr-home.tar.gz" -C "$HOME" layr
readlink -f "$HOME/layr/current" > "$bt26_backup/current-release.txt"
cp -a /etc/systemd/system/layr-web.service /etc/systemd/system/layr-kiosk.service "$bt26_backup/"
if [ -f /etc/pam.d/layr-kiosk ]; then
  cp -a /etc/pam.d/layr-kiosk "$bt26_backup/layr-kiosk.pam"
fi
python3 - <<'PY'
from pathlib import Path
import subprocess
home = Path.home()
backup = home / 'layr-bt26-before-0.2.0-20261104.2'
profile = str(home / '.config/layr-chromium')
for line in (home / 'layr/layr.env').read_text().splitlines():
    if line.startswith('LAYR_PROFILE='):
        profile = line.split('=', 1)[1].strip()
        if len(profile) >= 2 and profile[0] == profile[-1] and profile[0] in ('"', "'"):
            profile = profile[1:-1]
path = Path(profile)
if not path.is_absolute() or not path.is_dir():
    raise SystemExit('Stop: verify the actual working absolute Chromium profile: ' + profile)
(backup / 'chromium-profile-path.txt').write_text(str(path) + '\n')
subprocess.run(['tar', '-czf', str(backup / 'chromium-profile.tar.gz'), '-C', str(path), '.'], check=True)
print('Backup:', backup, '\nBrowser profile:', path)
PY
tar -tzf "$bt26_backup/layr-home.tar.gz" >/dev/null
tar -tzf "$bt26_backup/chromium-profile.tar.gz" >/dev/null
)
```

Do not proceed if backup failed. No printer files or Moonraker settings on the
remote host are read for backup or changed. Keep all existing LAYR releases.

## In-place upgrade

Do not pass `--moonraker`, `--port`, `--autostart` or a new browser profile. The
saved endpoint/port are authoritative and must appear unchanged in preflight.
Do not bypass connectivity failures silently. X11 explicitly selects XWayland
and compatible Bookworm packages; Qt, local Klipper/Moonraker and KlipperScreen
are not required/installed. The bundle includes dependency selection and config
templates, not offline `.deb` files. APT access is required for missing packages.

```bash
(
set -e
cd "$HOME/layr-test-builds/layr-bt26-test-0.2.0-20261104.2"
sudo -v
python3 deploy/layr preflight --profile kiosk --chromium-backend x11 --dist ./dist
python3 deploy/layr install --profile kiosk --chromium-backend x11 --dist ./dist
cmp "$HOME/layr/management/bt26-build.json" "$HOME/layr/current/bt26-build.json"
layr status
layr kiosk-diagnose
layr display-power status
test "$(systemctl is-enabled layr-kiosk.service 2>/dev/null || true)" = disabled
if systemctl is-active --quiet layr-kiosk.service; then
  echo 'Stop: installation unexpectedly started the kiosk.' >&2
  exit 1
fi
)
```

The web service is installed/validated first. Management/launcher/unit files are
refreshed; a new web release is added and old releases retained. Moonraker/port,
browser storage and printer/image profiles are preserved. Display power stays
disabled because no enable command has been issued. If previously experimented
with this component, its earlier disable in the backup block remains in force.

## Supervised physical tests

```bash
layr switch layr
layr status
layr kiosk-diagnose
layr display-power status
```

Verify visible **service-launched** LAYR, X11 backend, unprivileged Cage/Chromium,
all ELAN touch areas/scrolling, existing printer identity/photos and remote
Moonraker connection. Test CLI actions repeatedly and Back/Exit. Test all three
bundled image choices and cancellation without opening a native dialog. Check
SSH/console recovery; a running process alone is insufficient. Keep startup
disabled. Native file-picker touch remains a known limitation.

Only once that service preview works, stay in Settings away from heater/motion
controls and test optional power management:

```bash
layr display-power configure --idle-minutes 5 --dim --dim-percent 20
layr display-power enable
layr display-power status
```

Verify normal brightness, dim at four idle minutes and backlight off at five.
Continuous/held touch and keyboard input must keep it bright. Short power press
must restore brightness without shutting down, restarting Linux or losing
SSH/Wi-Fi/Moonraker. A dark screen is not a lock: touch still reaches Chromium;
wake with the power button before touching it. Check SSH wake separately:

```bash
layr display-power wake
layr display-power diagnose --json
sudo journalctl -b -u layr-display-power.service -n 200 --no-pager
layr display-power disable --yes
```

The controller must restore its original brightness and release its runtime
power-key inhibitor on disable, kiosk exit and failure. A pre-existing
`HandlePowerKey=ignore` remains unchanged. Test 1/10/Never, dim toggle/percentage,
input hotplug, controlled crash recovery and policy restoration using
`docs/display-power.md`. Do not enable kiosk autostart until service display,
touch and recovery have physically passed. `layr enable-kiosk` is the separate
explicit physical-confirmation flow; cold-boot/Wi-Fi persistence needs a later
supervised test. Do not run shutdown/reboot during initial validation.

## SSH recovery and rollback

Run these on the tablet if anything fails; stop at restoration errors:

```bash
layr display-power wake
layr display-power disable --yes
layr recover
sudo chvt 1
layr kiosk-diagnose
sudo journalctl -b -u layr-kiosk.service -n 200 --no-pager
```

Normal **local tablet** shutdown remains `sudo systemctl poweroff` when deliberately
requested later. LAYR's printer-host shutdown control targets remote Moonraker
and is unrelated. This feature never suspends Linux or changes networking.

For web-only rollback (retains settings/storage and all releases):

```bash
layr display-power disable --yes
layr recover
layr rollback --yes
```

This does not restore management code, units or packages. To restore the complete
pre-test management/configuration, keep kiosk stopped/disabled, remove only the
optional power component using its **trusted installed root helper**, then restore
the saved management files. Browser data is retained to preserve new photos.

```bash
(
set -e
layr display-power disable --yes
layr recover
if [ -f /usr/local/lib/layr-display-power/controller.py ]; then
  sudo /usr/bin/python3 -I /usr/local/lib/layr-display-power/controller.py uninstall
fi
bt26_backup="$HOME/layr-bt26-before-0.2.0-20261104.2"
bt26_old_release=$(cat "$bt26_backup/current-release.txt")
case "$bt26_old_release" in "$HOME/layr/releases/"*) ;; *) echo 'Unexpected saved release path' >&2; exit 1 ;; esac
test -f "$bt26_old_release/index.html"
bt26_restore=$(mktemp -d "$HOME/layr-bt26-restore-XXXXXX")
tar -xzf "$bt26_backup/layr-home.tar.gz" -C "$bt26_restore"
test ! -e "$HOME/layr/bin-after-beta-2"
test ! -e "$HOME/layr/management-after-beta-2"
mv "$HOME/layr/bin" "$HOME/layr/bin-after-beta-2"
mv "$HOME/layr/management" "$HOME/layr/management-after-beta-2"
cp -a "$bt26_restore/layr/bin" "$HOME/layr/bin"
cp -a "$bt26_restore/layr/management" "$HOME/layr/management"
cp -a "$bt26_restore/layr/layr.env" "$HOME/layr/layr.env"
for bt26_state_name in previous installer.json; do
  if [ -f "$bt26_restore/layr/state/$bt26_state_name" ]; then
    cp -a "$bt26_restore/layr/state/$bt26_state_name" "$HOME/layr/state/$bt26_state_name"
  else
    rm -f "$HOME/layr/state/$bt26_state_name"
  fi
done
ln -sfn "$bt26_old_release" "$HOME/layr/current"
sudo install -m 644 "$bt26_backup/layr-web.service" /etc/systemd/system/layr-web.service
sudo install -m 644 "$bt26_backup/layr-kiosk.service" /etc/systemd/system/layr-kiosk.service
if [ -f "$bt26_backup/layr-kiosk.pam" ]; then
  sudo install -m 644 "$bt26_backup/layr-kiosk.pam" /etc/pam.d/layr-kiosk
elif [ -f /etc/pam.d/layr-kiosk ] && grep -q '^# LAYR-managed kiosk PAM session' /etc/pam.d/layr-kiosk; then
  sudo rm /etc/pam.d/layr-kiosk
fi
sudo systemctl daemon-reload
sudo systemctl disable layr-kiosk.service
sudo systemctl restart layr-web.service
)
```

Do not restart the old failed kiosk automatically. Keep the backup, restoration
directory, new releases and saved failed management files for diagnosis. Packages
are not purged/downgraded. Do not restore the closed-browser backup over a live
profile or delete stored printer images. If the global CLI is broken, the trusted
root helper's `restore`/`uninstall` recovery is documented in `docs/display-power.md`.

## Reproduce and limitations

`BUILD.json`, matching installer/frontend metadata, `SOURCE-MANIFEST.json`,
`DIST-MANIFEST.json` and `SHA256SUMS` identify this exact committed build. Source,
locked npm dependencies and release tooling are included. On a build workstation
check out the recorded source commit, use Node 24.19.0, `npm ci`, then
`python3 tools/bt26_release.py build --output NEW_DIRECTORY`. The tar/gzip metadata
uses the commit timestamp and deterministic ordering; no target compilation is
needed. Run `python3 tools/bt26_release.py verify ARCHIVE` for a clean-extract check.

Read the associated GitHub Actions run for full installer, unit, browser,
authenticated-browser, Pi, build, shell and generated-unit results. Unit validation
uses a private Polkit dependency stub and does not start a native systemd session.
Architecture fixtures do not certify physical i386/amd64/ARM devices. Rotation,
calibration, multi-GPU selection, native file-picker touch, service/VT ownership,
real controller sandbox/ioctls/timing, crash recovery and boot/Wi-Fi persistence
have the limitations recorded in `docs/compatibility.md` and `docs/display-power.md`.
