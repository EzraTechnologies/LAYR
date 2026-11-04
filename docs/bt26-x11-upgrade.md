# BT26: confirmed manual X11 touch operation and in-place upgrade

Owner-reported physical result, received 2026-11-04: Mecer B26T/BT26, Atom Z3775D,
Debian 12 i386, Intel i915/eDP, Cage 0.1.4, Chromium 156 and ELAN1001:00 04F3:2029.
Manual Cage + Chromium `--ozone-platform=x11`, with XWayland installed, displays
LAYR and responds to touch. Native Chromium Wayland displays LAYR but touch does
not work in that tested configuration. This is a **manual rendering/touch pass**,
not validation of the systemd kiosk session, automatic startup, Wi-Fi recovery,
suspend/resume, calibration across all orientations or cold-boot persistence.

Cage remains a Wayland compositor in both modes. X11 means Chromium uses Cage's
XWayland server; it does not install a desktop/Xorg session, change a display
manager or bypass browser security. The old service's logind/VT activation denial
is a separate issue, tracked in [bt26-blank-screen.md](bt26-blank-screen.md).
Changing Ozone does not itself fix that denial. The proposed dedicated PAM/logind
session and supervisor still need supervised service-based testing on this device.

## Files and backup

All revised files are local to the review workspace; no new download has been
published, pushed or deployed. The old GitHub bundle lacks these changes. Use a
new reviewed `layr-bt26-x11-review.tar.gz` and its separately verified checksum;
never mix it into a previously extracted directory. No Node/npm is needed on the
tablet. No Debian reinstallation is required.

Run only on the tablet, as the normal installation owner. Keep a USB keyboard and
a second SSH connection available. Close the successful manual Cage session with
Ctrl+C in its original console before testing the service; do not kill all user
processes or delete Chromium profile locks. Retain its exact launch command and
profile path as evidence. The installer preserves existing `LAYR_PROFILE` and
uses the existing `~/.config/layr-chromium` default when unset; it does not migrate
or replace a manually selected different profile.

Preserve evidence, then stop only the old kiosk using a bounded wait:

```bash
sudo -v
sudo journalctl -b -u layr-kiosk.service -n 250 --no-pager > "$HOME/layr-bt26-before-x11.log"
sudo systemctl disable layr-kiosk.service
if ! timeout 10s sudo systemctl stop layr-kiosk.service; then
  sudo systemctl kill --kill-who=all --signal=SIGKILL layr-kiosk.service
fi
sudo systemctl reset-failed layr-kiosk.service
sudo chvt 1
systemctl is-active layr-web.service

bt26_backup="$HOME/layr-bt26-before-x11-$(date +%Y%m%dT%H%M%S)"
mkdir "$bt26_backup"
cp -a "$HOME/layr/bin" "$HOME/layr/management" "$HOME/layr/layr.env" "$HOME/layr/state" "$bt26_backup/"
cp -a /etc/systemd/system/layr-web.service /etc/systemd/system/layr-kiosk.service "$bt26_backup/"
if [ -f /etc/pam.d/layr-kiosk ]; then
  cp -a /etc/pam.d/layr-kiosk "$bt26_backup/layr-kiosk.pam"
fi
printf 'Backup: %s\n' "$bt26_backup"
```

With all Chromium instances using the LAYR profile closed, back up that actual
profile too. Do not change `LAYR_PROFILE` merely to match an example. Existing
releases are retained; ensure sufficient disk space for the additional web release
and your backups on this small tablet.

## Install the reviewed update

Assuming the new archive and checksum were transferred to your home directory:

```bash
cd "$HOME"
sha256sum -c layr-bt26-x11-review.tar.gz.sha256
```

Stop if checksum verification fails. Then, from a new extraction directory:

```bash
(
set -e
mkdir "$HOME/layr-bt26-x11-update"
tar -xzf "$HOME/layr-bt26-x11-review.tar.gz" -C "$HOME/layr-bt26-x11-update"
cd "$HOME/layr-bt26-x11-update"
sudo -v
python3 deploy/layr preflight --profile kiosk --chromium-backend x11 --moonraker http://192.168.15.14:7125 --dist ./dist
python3 deploy/layr install --profile kiosk --chromium-backend x11 --moonraker http://192.168.15.14:7125 --dist ./dist
layr status
layr backend
layr kiosk-diagnose
systemctl is-enabled layr-kiosk.service || true
)
```

Stop at any failed check. Preflight checks the XWayland and other kiosk package
candidates and simulates APT resolution before changing anything. Installation
prepares XWayland, polkitd and the other kiosk dependencies, preserves the browser
profile/Moonraker configuration and retains existing release directories. It adds
a web release and refreshes management/launcher/unit files. It neither starts the
unverified kiosk nor enables its boot startup. `is-enabled` should say `disabled`
(nonzero status is normal). No printer configuration is edited.

## Service preview and confirmation

Ensure the earlier manual Cage/browser is closed. Start exactly one explicit
service preview while watching the physical screen:

```bash
layr switch layr
layr status
sudo journalctl -b -u layr-kiosk.service -n 150 --no-pager
```

Verify a rendered UI, real touch taps/scrolling, remote printer identity and
Ctrl+Alt+F1/SSH recovery. An active process or the earlier successful manual launch
is insufficient. Only after the **service-based X11 preview** works:

```bash
layr enable-kiosk
```

This requires interactive `VISIBLE` confirmation and a separate touch answer.
The running service backend must match the saved backend. The record is scoped
to this device, this backend and `layr-kiosk.service`. Backend changes invalidate
previous confirmation and disable kiosk boot startup without restarting a browser.
Only then conduct and record a supervised cold-boot/Wi-Fi test.

If service startup fails, leave startup disabled and recover through SSH:

```bash
layr recover
sudo chvt 1
layr kiosk-diagnose
systemctl status layr-web.service layr-kiosk.service --no-pager
```

Use the bounded old-unit stop above if testing an older unit that still hangs.
Do not terminate all of the user's sessions. The working web service remains
available; switching Chromium backends does not repair logind/VT authorization.

## Select or roll back only the browser backend

The global terminal menu stays open after each action. Choose **4. Display and
touchscreen**, then **4. Chromium X11 / XWayland** or **5. Chromium native Wayland**;
`0` goes back, and acknowledgement returns to the main menu. Explicit SSH commands:

```bash
layr backend                               # show saved setting
layr backend --chromium-backend x11         # checks/installs XWayland, saves x11
layr backend --chromium-backend wayland     # save the former Raspberry Pi default
layr status --json                         # detailed configured/service evidence
```

These commands do not restart a running browser or change web releases. After a
change, stop the old service with `layr recover`, then request a new preview with
`layr switch layr`. Physical service confirmation is required again. Do not expect
Wayland touch to work on the BT26 based on the current evidence. WPE/Cog remains
a separate optional engine and is unaffected by the Chromium setting.

Web rollback (`layr rollback --yes`) changes web assets only; it does not undo a
backend, dependency or unit change. For installer-code rollback, use the explicit
backup restore procedure in [bt26-blank-screen.md](bt26-blank-screen.md), selecting
the backup above and keeping the failed kiosk disabled. No packages are purged.

## Read-only evidence still needed for service/VT diagnosis

After the new service preview, collect these outputs, even if manual X11 works:

```bash
systemctl cat layr-kiosk.service
systemctl show layr-kiosk.service -p ActiveState -p SubState -p MainPID -p ExecMainStatus -p User -p PAMName -p TTYPath
sudo journalctl -b -u layr-kiosk.service -n 200 --no-pager
loginctl list-sessions
for s in $(loginctl list-sessions --no-legend | awk -v owner="$(id -un)" '$3 == owner {print $1}'); do
  loginctl show-session "$s" -p User -p Type -p Class -p Seat -p VTNr -p Active -p Remote -p Leader -p Service
done
dpkg-query -W cage chromium xwayland polkitd libpam-systemd libseat1
systemctl status polkit.service systemd-logind.service dbus.service --no-pager
ps -eo pid,ppid,sid,pgid,tty,stat,comm | grep -E 'cage|chromium|Xwayland|sd-pam|layr'
```

Do not infer missing Polkit or an i915 defect from an authorization denial alone.
No new GPU, permissions or session workaround was added with this backend change.


## Native photo-picker limitation

The BT26 owner subsequently reported that native Linux photo selection does not
respond to touch, despite working Cage/X11 web input. Use the reviewed updated
app's in-page bundled illustration chooser; native upload remains behind an
explicit button with a keyboard/mouse warning. Do not reopen the old picker on a
touch-only setup. See [touchscreen-file-picker.md](touchscreen-file-picker.md) for
physical verification, cancellation/recovery and read-only toolkit diagnostics.
The fallback has not yet been physically retested or published.
