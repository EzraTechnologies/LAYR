# BT26 blank-screen investigation and local fixes

**Latest evidence:** the owner subsequently validated manual Cage + Chromium
X11/XWayland with ELAN touch. Native Chromium Wayland renders but touch fails.
The systemd session/VT failure remains separate and unverified. Use the current
[in-place X11 upgrade guide](bt26-x11-upgrade.md); the commands below document the
earlier session investigation and recovery.

Reported physical target: Mecer B26T/BT26, Intel Atom Z3775D, Debian 12 Bookworm
i386, about 1.4 GB available RAM, i915 graphics and internal eDP-1. No
KlipperScreen is installed. The web service works and the remote Moonraker API
at `http://192.168.15.14:7125` responds. The kiosk unit reports active but the
screen shows a flashing underscore. Later logs confirm seat activation failure
and an ELAN1001:00 04F3:2029 touchscreen at /dev/input/event0; graphical output
and actual touch interaction are not validated.

**Initial symptom alone was insufficient; the later seat-activation evidence and session fix are recorded below.** Service activity does not identify whether Cage
has a working output, Chromium has painted a frame, or input events reach it.
No Intel driver, GPU flag, sandbox or firmware change was made from the initial
symptom alone. The subsequent session/backend change is based on the confirmed
seat activation errors and upstream documentation. Tablet logs are required
before selecting any hardware-specific fix.

## Evidence required from the currently installed tablet

Run over SSH and paste the output before replacing drivers or the kiosk launcher:

```bash
sudo journalctl -b -u layr-kiosk.service -u layr-web.service -n 250 --no-pager
systemctl show layr-kiosk.service -p ActiveState -p SubState -p MainPID -p NRestarts -p ExecMainStatus -p User -p PAMName -p TTYPath
systemctl cat layr-kiosk.service
loginctl list-sessions
ls -l /dev/dri /dev/tty7
id
command -v chromium chromium-browser cage
chromium --version
cage -h 2>&1
sudo journalctl -b -k --no-pager | grep -Ei 'i915|drm|firmware|touch|silead|goodix|hid|oom|out of memory|killed process'
# If libinput-tools is already installed:
sudo libinput list-devices
```

Depending on that evidence, the next read-only checks may include the actual
service session from `loginctl show-session`, permissions/ACLs on its DRM device,
PAM/runtime directory and kernel input-controller messages. Do not infer a missing
driver just from a missing product-name match. Do not add `--no-sandbox`, force
software rendering, switch wlroots backends, or replace drivers without evidence.

## Confirmed software issues fixed locally

- The terminal menu now loops until Exit, has Back options, acknowledges results,
  contains failures/cancellation and never automatically retries an operation.
  Non-interactive commands retain their one-shot behavior.
- Plain status is readable. `layr diagnose` and `layr status --json` retain detailed
  JSON. `layr kiosk-diagnose` preserves actual command exit codes and stderr,
  journal output, service state, version information and VT/DRM permission data.
  Session environment collection is limited to display/session variables.
- Web health, kiosk process state, graphical verification and touch function are
  separate fields. A running unit never becomes an automatic display/touch pass.
- Touch inventory uses `ID_INPUT_TOUCHSCREEN=1` udev properties and kernel
  direct-touch/absolute capabilities, with a clearly labeled name heuristic
  fallback. No identification means unknown, not absent.
- A universal kiosk install first installs the web service, validates local HTTP,
  then prepares kiosk dependencies and a disabled unit. No graphical process is
  started by installation on an unverified device.
- `layr switch layr` is a temporary preview with boot startup disabled. It checks
  prerequisites and asks for confirmation. A failed preview is stopped/disabled;
  a recorded previous KlipperScreen is restored only when it exists.
- `layr enable-kiosk` requires active process + local HTTP and a typed `VISIBLE`
  acknowledgement after looking at the actual device. `--yes` cannot bypass the
  physical acknowledgement. Touch confirmation is recorded separately. Previous
  confirmation is scoped to the device's machine ID, never treated as live proof.
- `--autostart` is retained, but an unverified device's request is held for the
  physical test. A previously confirmed device can opt in, subject to the usual
  display conflict checks. Legacy standalone Pi switching retains its existing
  path; use the universal CLI preview for this Intel tablet.
- The proposed kiosk unit uses `Restart=no` during this test phase. It retains
  journal output and logs initial session context instead of repeatedly hiding
  the first failure. No security protection or renderer backend is disabled.
- Shared recovery text is device-neutral. Application power controls now say
  **Printer host** and still target only the connected Moonraker host, not the
  tablet automatically. Command methods, interlocks and confirmations are retained.

These are generic software/safety fixes, not a proven fix for the flashing cursor.
The working Raspberry Pi installation was not accessed or modified.

## Upgrade without reinstalling Debian

All changes are local. **No updated build has been pushed or released.** The
existing GitHub test bundle does not contain these changes. The following is the
prepared sequence for a separately authorized, reviewed updated bundle; do not
reuse the old archive and expect these commands/options to have been added.

First preserve the current error log and stop/disable only the bad kiosk:

```bash
sudo journalctl -b -u layr-kiosk.service -n 250 --no-pager > "$HOME/layr-bt26-before-upgrade.log"
sudo -v
sudo systemctl disable layr-kiosk.service
if ! timeout 10s sudo systemctl stop layr-kiosk.service; then
  sudo systemctl kill --kill-who=all --signal=SIGKILL layr-kiosk.service
fi
sudo systemctl reset-failed layr-kiosk.service
# The working web service is kept running. Select a text console if needed:
sudo chvt 1
```

Back up the installer files and units on the tablet:

```bash
bt26_backup="$HOME/layr-bt26-backup-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$bt26_backup"
cp -a "$HOME/layr/bin" "$HOME/layr/management" "$HOME/layr/layr.env" "$bt26_backup/"
cp -a /etc/systemd/system/layr-web.service /etc/systemd/system/layr-kiosk.service "$bt26_backup/"
if [ -f /etc/pam.d/layr-kiosk ]; then
  cp -a /etc/pam.d/layr-kiosk "$bt26_backup/layr-kiosk.pam"
fi
printf 'Backup: %s\n' "$bt26_backup"
```

Once the reviewed updated archive is supplied, verify its separately supplied
checksum and extract it to `~/layr-bt26-update`. Do not reuse an old extracted
directory: mixed versions could hide missing files. As the normal installation owner:

```bash
test ! -e "$HOME/layr-bt26-update" || { echo "Choose a new, empty update directory"; exit 1; }
mkdir "$HOME/layr-bt26-update"
# After checksum verification, using the new archive's actual location:
tar -xzf "$HOME/layr-bt26-updated.tar.gz" -C "$HOME/layr-bt26-update"
cd "$HOME/layr-bt26-update"
sudo -v
python3 deploy/layr preflight --profile kiosk --moonraker http://192.168.15.14:7125 --dist ./dist
python3 deploy/layr install --profile kiosk --moonraker http://192.168.15.14:7125 --dist ./dist
layr status
layr kiosk-diagnose
```

Stop at any failed check. The installation refreshes management/launcher files and
units, records a previous web release and keeps kiosk boot startup disabled.
There is no Debian reinstall, printer configuration edit or remote Pi command.
After reviewing the device evidence, with keyboard and a second SSH session ready,
start only an explicit temporary preview:

```bash
layr switch layr
# If blank or unusable, from SSH:
layr recover
layr kiosk-diagnose
```

Only after seeing the actual rendered LAYR UI and testing input:

```bash
layr enable-kiosk
# Type VISIBLE only for a real visible UI; report touch success separately.
```

Check a supervised tablet cold boot only after that confirmation. Web rollback
(`layr rollback --yes`) restores web assets, not units or renderer dependencies.
Restore launcher/management/unit backups if installer-code rollback is needed;
keep the kiosk disabled while investigating. Uninstall (`layr uninstall --yes`)
removes LAYR units/command and retains data/packages. No KlipperScreen recovery
option is offered on this device while it is absent.

## Confirmed seat failure and revised session setup

The owner subsequently provided Cage 0.1.4 / Chromium 156 diagnostics:

```text
[libseat] Could not activate session: Permission denied
[seatd] Could not open tty0 to update VT: Permission denied
[seatd] Could not open VT for client
Failed to start a DRM session
Unable to create the wlroots backend
```

This confirms a **seat/session activation failure**, not an established i915
rendering defect. Direct seatd fallback cannot open the console as the normal
user. It must not be solved by root Chromium, chmod of DRM/input nodes, or a
blanket graphics-device group/capability grant.

The owner also confirmed `ELAN1001:00 04F3:2029` on `/dev/input/event0`, with
libinput `Capabilities: touch`. Detection now uses udev touchscreen tags OR kernel
`INPUT_PROP_DIRECT` plus absolute/multitouch capabilities. Kernel bitmaps are
parsed with the kernel word width (including i386). An ELAN name alone is not
sufficient because ELAN also makes touchpads. Identification remains distinct
from successful UI input interaction.

The proposed standalone session now uses:

- `User=` remains the normal installation owner. A dedicated, root-installed
  `/etc/pam.d/layr-kiosk` includes the standard account/credential policy and
  **required** pam_systemd session registration. No permissive authentication
  module, common PAM modification or custom Polkit override is installed.
- Explicit Wayland/user/seat0/VT7 session metadata, `PAMName=layr-kiosk`, and
  dependencies on logind, D-Bus and the stock `polkitd` service/policy. Bookworm
  i386's official package index contains polkitd 122-3. The installer checks its
  candidate rather than assuming it is installed on minimal Debian.
- A controlling, unoccupied tty7 via systemd's `tty-fail`, with other gettys and
  desktop sessions preserved. The former privileged `chvt` pre-command is removed.
  The normal user activates its validated local session through logind once.
- `LIBSEAT_BACKEND=logind`, without a seatd/direct-VT fallback. The supervisor
  verifies the session's actual UID, leader PID, seat, VT, type/class and Remote=no
  before activation. It will not borrow a default SSH or desktop session.
- `layr-session.py` is the PAM main process. Cage/Chromium are unprivileged child
  processes in their own process group within the **same** terminal session.
  No setsid or browser-root mode is used. The main process forwards stop signals,
  waits only for its renderer child and cleans up that renderer group.
- Five seconds of graceful renderer shutdown, then termination of the owned group;
  a 10-second systemd stop limit, `KillMode=mixed`, and `Restart=no`. The first
  startup error remains visible. Nonzero Cage status is propagated; an unexpected
  clean renderer exit is also reported as failure rather than graphical readiness.

The upstream references supporting this design are:

1. [systemd 252 systemd.exec](https://github.com/systemd/systemd/blob/v252/man/systemd.exec.xml)
   documents `(sd-pam)` as an immediate child of the service main process, and
   notes that PAM session children can belong to the session scope.
2. [Cage 0.1.4 source](https://github.com/cage-kiosk/cage/blob/v0.1.4/cage.c)
   initializes the primary-client PID to zero and uses `waitpid(pid, ...)` during
   cleanup. Keeping Cage as the PAM main process can therefore make failed-start
   cleanup wait on the PAM child. A supervisor avoids that ownership hazard.
   This is a source-confirmed hazard, not proof that it is the only contributor
   to the tablet's observed stop delay.
3. [systemd 252 logind Polkit check](https://github.com/systemd/systemd/blob/v252/src/login/logind-polkit.c)
   verifies `org.freedesktop.login1.chvt` for session activation. Its
   [stock policy](https://github.com/systemd/systemd/blob/v252/src/login/org.freedesktop.login1.policy)
   permits local sessions; it does not justify allowing arbitrary remote users.

The remaining read-only device checks requested are:

```bash
loginctl list-sessions
loginctl show-user karel -p Display -p Sessions
for s in $(loginctl list-sessions --no-legend | awk '$3 == "karel" {print $1}'); do
  loginctl show-session "$s" -p User -p Name -p Type -p Class -p Seat -p VTNr -p Active -p Remote -p Leader -p Service
done
ps -eo pid,ppid,sid,pgid,tty,stat,comm | grep -E 'cage|chromium|sd-pam|layr'
cat /etc/pam.d/login /etc/pam.d/common-session
dpkg-query -W polkitd libpam-systemd libseat1
systemctl status polkit.service systemd-logind.service dbus.service --no-pager
pkaction --action-id org.freedesktop.login1.chvt --verbose
```

Those results distinguish missing authorization service, incorrect session
registration and local policy restrictions. **We do not assume polkitd is absent
or override a policy denial.** Native PAM/logind/VT execution and visible rendering
still require supervised physical retesting after the new build is authorized
for transfer. No hardware-specific rendering flags have been added.

## Bounded recovery for the currently installed old unit

Use only on the BT26. Keep a second SSH connection open. These commands target
LAYR's kiosk, not the working web service, other user sessions or the printer:

```bash
sudo -v
sudo systemctl disable layr-kiosk.service
if ! timeout 10s sudo systemctl stop layr-kiosk.service; then
  sudo systemctl kill --kill-who=all --signal=SIGKILL layr-kiosk.service
fi
sudo systemctl reset-failed layr-kiosk.service
sudo chvt 1
systemctl is-active layr-web.service
```

The timeout bounds the client wait; the targeted kill is the explicit fallback
for the old stuck unit. Do not use `pkill -u karel`, `killall chromium`, or
`loginctl terminate-user karel`, which could terminate unrelated work/SSH sessions.
If a separate session remains, inspect its leader/VT/Remote fields before doing
anything else; do not terminate sessions by username alone.

During the in-place backup above, also preserve a pre-existing dedicated PAM file:

```bash
if [ -f /etc/pam.d/layr-kiosk ]; then
  cp -a /etc/pam.d/layr-kiosk "$bt26_backup/layr-kiosk.pam"
fi
```

The updated installer creates its owned PAM file and installs `polkitd` as part of
kiosk dependency preparation. It does not edit `/etc/pam.d/login` or common PAM
files. Uninstall removes only the LAYR-managed dedicated PAM file. Kiosk preview
and operator confirmation remain separate; a service-active result still does
not certify the graphical display or touchscreen.

## Restore the previous installer without restarting the failed kiosk

If necessary, select the backup path printed earlier, then restore only this
installation's code/configuration and units. Run the bounded stop procedure above
first. Keep the kiosk disabled; restoring the old unit does not fix its seat error.

```bash
# Replace with the exact backup directory printed above:
bt26_backup="$HOME/layr-bt26-backup-YYYYMMDDTHHMMSS"
test -d "$bt26_backup/bin" && test -d "$bt26_backup/management" || exit 1
cp -a "$bt26_backup/bin/." "$HOME/layr/bin/"
cp -a "$bt26_backup/management/." "$HOME/layr/management/"
cp -a "$bt26_backup/layr.env" "$HOME/layr/layr.env"
sudo install -m 644 "$bt26_backup/layr-web.service" /etc/systemd/system/layr-web.service
sudo install -m 644 "$bt26_backup/layr-kiosk.service" /etc/systemd/system/layr-kiosk.service
if [ -f "$bt26_backup/layr-kiosk.pam" ]; then
  sudo install -m 644 "$bt26_backup/layr-kiosk.pam" /etc/pam.d/layr-kiosk
fi
sudo systemctl daemon-reload
sudo systemctl disable layr-kiosk.service
sudo systemctl reset-failed layr-kiosk.service
systemctl status layr-web.service --no-pager
```

This does not roll back APT packages or web assets. Use `layr rollback --yes`
separately if the previous web release is needed. Do not reboot into an enabled
old kiosk or restore unrelated PAM, login, graphics or printer configuration.
