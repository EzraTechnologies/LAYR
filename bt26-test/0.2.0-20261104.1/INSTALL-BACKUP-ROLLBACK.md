# Combined Mecer BT26 test build: 0.2.0-20261104.1

This is an unpublished test archive, not a release. It combines the universal
CLI/X11/session/menu work with the in-page printer-image chooser and its three
bundled illustrations. Raspberry Pi's default Chromium backend stays Wayland.
No working Pi installation is accessed by these instructions. Qt is not required.

The archive has one top-level directory:
`layr-bt26-test-0.2.0-20261104.1/`. It contains `deploy/`, prebuilt `dist/`, this
guide, supporting docs, `BUILD-MANIFEST.json`, `TEST-RESULTS.md`, and `SHA256SUMS`.
The installer and frontend are copied/built from one frozen working-tree source
snapshot. The manifest records its Git base and source hash, because the changes
are uncommitted. `deploy/bt26-build.json` and `dist/bt26-build.json` must match.
`SOURCE-MANIFEST.json` is provenance for the source snapshot; `SHA256SUMS` verifies
files actually delivered in the archive. No Node/npm is needed on the tablet.

## Transfer from a computer holding the archive

The unpublished workspace path is not a URL or an SSH address. First obtain the
archive and its `.sha256` file on a computer that can SSH to the tablet. From the
directory containing those two files, run Bash:

```bash
read -r -p 'BT26 tablet SSH IP/hostname (NOT the printer): ' bt26_host
scp layr-bt26-test-0.2.0-20261104.1.tar.gz \
    layr-bt26-test-0.2.0-20261104.1.tar.gz.sha256 \
    "karel@${bt26_host}:~/"
ssh -t "karel@${bt26_host}"
```

`karel` is the reported tablet owner; substitute the actual owner if different.
Do not use the remote Moonraker printer's address as the SCP/SSH destination.
Compare the archive hash with the separately supplied trusted hash as well.

## Verify and extract on the tablet

Use the normal installation owner, never a root installer shell. Keep a keyboard
and a second SSH connection open. A full tablet image backup is recommended.
Stop at any failed check; no command below needs a Debian reinstall.

```bash
(
set -e
cd "$HOME"
sha256sum -c layr-bt26-test-0.2.0-20261104.1.tar.gz.sha256
mkdir -p "$HOME/layr-test-builds"
test ! -e "$HOME/layr-test-builds/layr-bt26-test-0.2.0-20261104.1"
tar -xzf layr-bt26-test-0.2.0-20261104.1.tar.gz -C "$HOME/layr-test-builds"
cd "$HOME/layr-test-builds/layr-bt26-test-0.2.0-20261104.1"
sha256sum -c SHA256SUMS
cmp deploy/bt26-build.json dist/bt26-build.json
cat dist/bt26-build.json
)
```

Do not extract over an older build. Read `TEST-RESULTS.md` and the limitations
below before installation. If sudo is missing/unauthorized, follow the minimal
Debian administrator setup in `docs/mecer-bt26-test.md`; do not run LAYR as root.

## Stop the old kiosk and preserve configuration/data

Close any *manual* Cage/Chromium session in its original console before taking a
browser-profile backup. Do not kill all user processes, delete profile locks or
clear browser data. Confirm that its working `--user-data-dir` agrees with the
saved `LAYR_PROFILE` (default `~/.config/layr-chromium`). If it differs, stop and
record the actual command/profile before upgrading; do not create a new profile
merely to match this example. The commands below use the existing `~/layr` root.
A custom installation root requires corresponding path adjustments.

```bash
(
set -e
sudo -v
sudo journalctl -b -u layr-kiosk.service -n 250 --no-pager > "$HOME/layr-bt26-before-combined.log"
sudo systemctl disable layr-kiosk.service
if ! timeout 10s sudo systemctl stop layr-kiosk.service; then
  sudo systemctl kill --kill-who=all --signal=SIGKILL layr-kiosk.service
fi
sudo systemctl reset-failed layr-kiosk.service
sudo chvt 1
if systemctl is-active --quiet layr-kiosk.service; then
  echo 'Stop: the old kiosk is still active.' >&2
  exit 1
fi
umask 077
bt26_backup="$HOME/layr-bt26-test-0.2.0-20261104.1-backup"
mkdir "$bt26_backup"
cp -a "$HOME/layr/bin" "$HOME/layr/management" "$HOME/layr/state" "$HOME/layr/layr.env" "$bt26_backup/"
readlink -f "$HOME/layr/current" > "$bt26_backup/current-release.txt"
cp -a /etc/systemd/system/layr-web.service /etc/systemd/system/layr-kiosk.service "$bt26_backup/"
if [ -f /etc/pam.d/layr-kiosk ]; then
  cp -a /etc/pam.d/layr-kiosk "$bt26_backup/layr-kiosk.pam"
fi
python3 - <<'PY'
from pathlib import Path
import shutil
home = Path.home()
backup = home / 'layr-bt26-test-0.2.0-20261104.1-backup'
profile = str(home / '.config/layr-chromium')
for line in (home / 'layr/layr.env').read_text().splitlines():
    if line.startswith('LAYR_PROFILE='):
        profile = line.split('=', 1)[1].strip()
        if len(profile) >= 2 and profile[0] == profile[-1] and profile[0] in ('"', "'"):
            profile = profile[1:-1]
path = Path(profile)
if not profile or not path.is_absolute():
    raise SystemExit('Stop: verify the actual absolute Chromium profile path before continuing')
(backup / 'chromium-profile-path.txt').write_text(str(path) + '\n')
if path.is_dir():
    shutil.copytree(path, backup / 'chromium-profile', symlinks=True)
else:
    raise SystemExit('Stop: configured profile does not exist; verify the working manual profile: ' + str(path))
print('Backup:', backup, '\nConfigured browser profile:', path)
PY
)
```

The versioned backup directory must not already exist: reuse the original backup
for repeat testing rather than overwriting your known pre-test files. Retain all
`~/layr/releases` directories. Profile backup requires free disk space and closed
browsers; it includes IndexedDB, localStorage and per-printer preferences. The
upgrade never deletes those stores. If the backup did not complete, do not proceed.

## Preflight and upgrade the existing installation

Do not pass `--moonraker`: preflight/install must retain the saved endpoint. Check
the printed endpoint and existing web port before confirming the install. If the
saved connection is missing or unreachable, stop and diagnose; do not guess a new
address or silently stage offline. The target is a dedicated Intel kiosk without
an active desktop manager. X11 adds XWayland; kiosk dependencies include polkitd.
Neither Klipper, Moonraker nor KlipperScreen is installed locally by this process.

```bash
(
set -e
cd "$HOME/layr-test-builds/layr-bt26-test-0.2.0-20261104.1"
sudo -v
python3 deploy/layr preflight --profile kiosk --chromium-backend x11 --dist ./dist
python3 deploy/layr install --profile kiosk --chromium-backend x11 --dist ./dist
cmp "$HOME/layr/management/bt26-build.json" "$HOME/layr/current/bt26-build.json"
layr status
layr backend
bt26_boot_state=$(systemctl is-enabled layr-kiosk.service 2>/dev/null || true)
test "$bt26_boot_state" = disabled
if systemctl is-active --quiet layr-kiosk.service; then
  echo 'Stop: installation unexpectedly started the kiosk.' >&2
  exit 1
fi
)
```

No `--autostart` is used. The installer refreshes management/launchers and units,
adds a web release, and preserves prior release directories and rollback history.
It retains saved Moonraker/port/profile/cursor settings except the explicitly
selected X11 backend. Browser/printer profiles and image storage retain their
existing origin/profile. No printer configuration, common PAM, Wi-Fi settings or
unrelated desktop session is edited. Local HTTP is validated before kiosk setup.
A web/API success is not a graphical or touch success.

## Physical validation checklist

Start a single temporary **service-based** preview only when keyboard/SSH recovery
is ready and the old manual compositor is closed:

```bash
layr switch layr
layr status
layr kiosk-diagnose
```

- [ ] Global `layr` opens the management menu; status/control/display actions return
      to the main menu; Back, invalid input, cancellation and Exit behave properly.
- [ ] Saved Moonraker endpoint, web port, printer identity and browser profile are
      unchanged; local HTTP works; remote WebSocket/API reconnects. Avoid motion
      and heater controls during this validation.
- [ ] The service—not a separately running manual Cage—renders LAYR. No flashing
      cursor, failed seat activation, exit/restart loop or persistent blank screen.
- [ ] Status shows configured/running X11; Chromium and Cage are not root. Check
      journal evidence, not only the service's active state.
- [ ] ELAN touch reaches buttons, all screen corners, scrolling and text entry.
- [ ] Settings → Choose photo opens the in-page chooser without a system dialog.
      Each of the three illustrations selects/saves with touch. Cancel before Apply
      preserves the previous image; Home, reload and removal behave correctly.
- [ ] Existing custom photos/preferences persist. Native upload is tested only
      with a keyboard/mouse available; its touch bug is not claimed fixed.
- [ ] Ctrl+Alt+F1 and SSH recovery work; stopping the kiosk completes promptly and
      leaves the web service available. Check Wi-Fi reconnection and suspend/resume.
- [ ] Automatic startup stays disabled throughout these tests. Record logs/results.

If any item fails, recover from SSH and leave startup disabled:

```bash
layr recover
sudo chvt 1
layr kiosk-diagnose
sudo journalctl -b -u layr-kiosk.service -n 200 --no-pager
```

Only after the service-based display/input/recovery tests pass, enable startup
through the explicit physical confirmation flow:

```bash
layr enable-kiosk
```

Type `VISIBLE` only for an actual working service-launched UI. Then test a tablet
cold boot and Wi-Fi persistence with SSH recovery available. Cold-boot persistence
remains unverified until that later test passes; no boot command is run here.

## Safe rollback

A web-only rollback preserves current configuration and browser data:

```bash
layr recover
layr rollback --yes
```

It changes the web release pointer only, and does not restore installers, units,
backend selection or APT packages. Do not immediately restart an unverified old
kiosk. To restore the complete pre-test installer/configuration/units, run the
bounded stop/disable procedure above first, then this Bash block as the owner:

```bash
(
set -e
bt26_backup="$HOME/layr-bt26-test-0.2.0-20261104.1-backup"
test -f "$bt26_backup/current-release.txt"
bt26_old_release=$(cat "$bt26_backup/current-release.txt")
case "$bt26_old_release" in "$HOME/layr/releases/"*) ;; *) echo 'Stop: unexpected saved release path' >&2; exit 1 ;; esac
test -f "$bt26_old_release/index.html"
# Keep the failed new tools for inspection; never overlay mixed installer files.
test ! -e "$HOME/layr/bin-after-bt26-test-0.2.0-20261104.1"
test ! -e "$HOME/layr/management-after-bt26-test-0.2.0-20261104.1"
mv "$HOME/layr/bin" "$HOME/layr/bin-after-bt26-test-0.2.0-20261104.1"
mv "$HOME/layr/management" "$HOME/layr/management-after-bt26-test-0.2.0-20261104.1"
cp -a "$bt26_backup/bin" "$HOME/layr/bin"
cp -a "$bt26_backup/management" "$HOME/layr/management"
cp -a "$bt26_backup/layr.env" "$HOME/layr/layr.env"
ln -sfn "$bt26_old_release" "$HOME/layr/current"
for bt26_state_name in previous installer.json; do
  if [ -f "$bt26_backup/state/$bt26_state_name" ]; then
    cp -a "$bt26_backup/state/$bt26_state_name" "$HOME/layr/state/$bt26_state_name"
  else
    rm -f "$HOME/layr/state/$bt26_state_name"
  fi
done
sudo install -m 644 "$bt26_backup/layr-web.service" /etc/systemd/system/layr-web.service
sudo install -m 644 "$bt26_backup/layr-kiosk.service" /etc/systemd/system/layr-kiosk.service
if [ -f "$bt26_backup/layr-kiosk.pam" ]; then
  sudo install -m 644 "$bt26_backup/layr-kiosk.pam" /etc/pam.d/layr-kiosk
elif [ -f /etc/pam.d/layr-kiosk ] && grep -q '^# LAYR-managed kiosk PAM session' /etc/pam.d/layr-kiosk; then
  sudo rm /etc/pam.d/layr-kiosk
fi
sudo systemctl daemon-reload
sudo systemctl disable layr-kiosk.service
sudo systemctl reset-failed layr-kiosk.service
sudo systemctl restart layr-web.service
)
```

Before rollback, ensure both `*-after-bt26-test-*` destinations do not already
exist; the commands are intended once and stop on errors. Browser data is retained,
not restored automatically: this avoids deleting photos/preferences created during
testing. The closed-browser backup is a separate last resort. All original and
new release directories are kept. APT packages are not purged or downgraded.
Do not replace common PAM files, kill all user sessions, clear Chromium storage,
or enable the old failed kiosk as part of rollback.

## Remaining limitations

The owner validated **manual** Cage + Chromium X11/XWayland rendering/ELAN touch
on Debian 12 i386. Native Chromium Wayland touch failed. The dedicated systemd
session/VT startup, this combined in-page chooser build, Wi-Fi recovery and cold
boot remain physical test items. The native GTK/portal file-picker touch fault
is not repaired; use the bundled chooser for touch-only operation. Rotation and
calibration are not implemented. Automated ARM/i386/amd64 tests do not certify
additional hardware. See `docs/compatibility.md`, `docs/bt26-blank-screen.md`,
`docs/touchscreen-file-picker.md` and the final `TEST-RESULTS.md` in this archive.
