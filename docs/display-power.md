# Optional Intel tablet display power

Status: prepared locally for review and supervised Mecer BT26 testing. The owner
validated the BT26 kernel backlight API and physical power-button events; the new
service/sandbox has not yet run on that device. No live Pi deployment is part
of this change. The earlier `0.2.0-20261104.1` combined download lacks this feature;
use the [Beta 2 guide](bt26-beta-2.md) for the combined versioned package.

## Behavior and scope

Display power is **disabled by default**, including every Raspberry Pi and normal
Intel installation. It requires an explicitly selected dedicated kiosk profile,
Debian 12 i386/amd64, Intel CPU, an i915-owned backlight with valid `brightness`,
`max_brightness` and `bl_power`, a connected internal eDP/LVDS/DSI panel and a seat0
input device advertising `KEY_POWER`. Multiple backlights require explicit
selection. Other architectures/drivers and incomplete wake hardware are refused
before installing/starting the optional root controller. Capability checks are
not certification of another tablet model.

Defaults after explicit opt-in:

- Normal brightness is captured from the active display, not assumed to be maximum.
- At four idle minutes: dim to 20% of that normal value, rounded to hardware units
  with minimum one. For normal 7812 the dim target is 1562.
- At five idle minutes: write `4` to the selected backlight's `bl_power`.
- Short `KEY_POWER` press or SSH wake: restore normal brightness, then `bl_power=0`.
  Presses always wake/reset idle; they never toggle the display off.
- Linux, Cage/Chromium and Moonraker remain running. There is no suspend, hibernate,
  network operation, printer RPC, display-manager takeover or root browser.

Timeout choices are 1, 5, 10 minutes and Never. Dimming starts at 80% of the chosen
timeout (48 seconds, four minutes, eight minutes). Never suppresses automatic dim
and off; disabling dim suppresses only the dim stage. Off transitions have a short
settling interval (at least 250 ms) to drain/recheck queued input before blanking.
After a wake, a fresh full inactivity interval is required.

Raw seat0 keyboard, mouse, touchpad/touchscreen activity keeps LAYR awake. Held
keys and active multitouch contacts count even without motion. Input state is
snapshotted at startup, new devices are discovered, repeats/bounce do not toggle
power, and dropped input/disconnection fails open to the original backlight.
A switched-away kiosk session is kept bright and its idle timer paused; another
active desktop manager/KlipperScreen causes restoration and controller exit.
The browser's page visibility, video/animation and printer updates do not reset
idle. No frontend code or browser privilege changes are involved.

**This is a backlight control, not a screen lock.** Input is not grabbed, disabled
or filtered away from Chromium. With power-button wake selected, touch on an
already dark screen does not wake it and can still reach the app: press the power
button before touching it. Do physical tests in Settings, away from motion/heater
controls. Hardware/firmware long-press forced poweroff cannot be prevented; use
short presses only.

## CLI and menu

After installing the reviewed updated management scripts/prebuilt frontend as the
normal LAYR owner (not root), select `layr` → **4. Display and touchscreen** →
**6. Display power management**. It offers support/status, enable/disable, timeout,
dim toggle/percentage, restore now, fixed power-button wake method and Back. Each
completed operation returns to the main menu and is never automatically repeated.

Read-only commands work without sudo:

```bash
layr display-power status
layr display-power diagnose --json
```

Explicit settings/actions (existing validated sudo authorization is required):

```bash
layr display-power configure --idle-minutes 5 --dim --dim-percent 20
layr display-power enable
layr display-power wake
layr display-power configure --idle-minutes 1
layr display-power configure --idle-minutes 10
layr display-power configure --idle-minutes never
layr display-power configure --no-dim
layr display-power disable
```

`--dim-percent` accepts integer 1–100. `--wake-method power-button` is the only
supported method. `--backlight NAME` selects a discovered class name when needed;
never pass a `/sys` path. `--dry-run` previews without installing/changing files.
Automation can add `--yes` with cached/NOPASSWD sudo; otherwise it fails clearly
rather than assuming sudo/group membership. `wake` itself does not ask for an
extra confirmation, although sudo may authenticate in a terminal. For SSH use:

```bash
ssh -t karel@TABLET_IP 'layr display-power wake'
# Non-interactive only with suitable sudo authorization already available:
ssh karel@TABLET_IP 'layr display-power wake --yes'
```

Replace TABLET_IP with the tablet, not the remote printer. Standard local CLI
shutdown is still `sudo systemctl poweroff`: only physical power-key handling is
inhibited, not shutdown requests. LAYR's existing printer-host shutdown control
still targets the remote Moonraker host and is unrelated to this feature.

A service-based `layr-kiosk.service` preview must already run before enabling
power management. Manual Cage success is insufficient. Enabling this optional
service **does not enable kiosk boot startup**. The existing separate physical
confirmation/`layr enable-kiosk` requirement remains in effect.

## Privilege, logind and recovery design

The service is root only because backlight/input access is privileged. On explicit
configure/enable, the CLI copies the reviewed helper to
`/usr/local/lib/layr-display-power/controller.py`, root:root 0755. It never launches
root Python from user-writable `~/layr`, a Chromium profile or the source checkout.
The interpreter uses isolated mode; helper/ancestor ownership and writable/symlink
checks precede root execution. Settings are schema-checked root-owned JSON at
`/etc/layr/display-power.json`; the ordinary installer leaves this absent.
No sudoers rule or broad input/video permissions are added.

The generated `layr-display-power.service` is bound to the kiosk and logind. It
has no capabilities, no HOME access, a read-only filesystem, AF_UNIX only, input
character devices read-only, and write access to exactly the selected kernel
`brightness`/`bl_power` files plus its own systemd state/runtime directories.
It does not have DRM device access or CAP_SYS_PTRACE. Session ownership is checked
through logind's public metadata/leader PID, not by reading another user's process
environment. The selected backlight is resolved/validated against i915, and input
paths are discovered from kernel capabilities and udev seat information; neither
`intel_backlight`, brightness 7812 nor `/dev/input/event9` is hardcoded.

`systemd-inhibit --what=handle-power-key --mode=block` holds a low-level logind
inhibitor while the controller runs. No `HandlePowerKey=` file or drop-in is edited
and logind is never restarted. The inhibitor automatically releases when the
process exits. [systemd 252's inhibitor wrapper](https://github.com/systemd/systemd/blob/v252/src/login/inhibit.c)
acquires the lock, forks the command and waits for it; the daemon verifies that
wrapper before permitting blanking. A previous administrator setting such as
`HandlePowerKey=ignore` remains unchanged on disable/uninstall. After stopping,
the existing OS power-button policy resumes; do not assume it is always poweroff
or always ignore.

Before writing the backlight, the daemon durably saves its original normal
brightness/power and device/machine identity under
`/var/lib/layr-display-power/original.json`. Restoration marks the journal complete
so repeated stops do not overwrite a later user brightness change. On normal
stop, fatal input/session error or kiosk exit it restores those values. A bounded
five-second stop and independent `ExecStopPost` restore cover SIGKILL/crashes;
`Restart=no` avoids rapid recovery/blanking loops. The control socket is root-only
and accepts a bounded wake request, not paths, brightness writes or shell commands.
Requests are framed to handle partial reads and cancelled SSH clients safely.
No input key contents/events are persisted in logs or status.

Configure while enabled stops/restores the old controller before changing settings
and restarts it only if the kiosk is active. Choose the desired normal brightness
before enabling. To change it later, disable, adjust brightness normally, then
enable again. The feature's code is independent of web release rollback and is
updated only by another explicit configure/enable, not by following a user-writable
code symlink.

Disable restores brightness, stops/disables the optional service and releases the
inhibitor. `layr uninstall` performs that cleanup before removing LAYR units/data;
it removes only the owned controller/config/unit and does not change other power
managers or pre-existing logind files. If restoration/controller integrity fails,
uninstall stops with a precise error rather than purging the recovery tools.

## Exact supervised BT26 validation

Use reviewed updated files; do not run these new commands against the previous
uploaded combined archive. In-place install uses the existing procedure with
`--profile kiosk --chromium-backend x11 --dist ./dist`, without `--moonraker` or
`--autostart`. That preserves Moonraker/profile/releases and initially leaves the
new optional power service disabled. Keep a keyboard and two SSH sessions open.
If the known Cage systemd session/VT problem remains, resolve/test that separately
first; this feature must not hide a failed graphical service.

From the freshly extracted **reviewed update** directory on the tablet, as the
existing installation owner, first save the current management files and then
run the in-place installer. This block assumes the existing default `~/layr`
installation; use the configured installation path if different. The frontend
must be the update's prebuilt `dist`, not a Node build attempted on i386.

```bash
(
set -e
bt26_power_backup="$HOME/layr-before-display-power-$(date +%Y%m%dT%H%M%S)"
mkdir "$bt26_power_backup"
cp -a "$HOME/layr/management" "$HOME/layr/bin" "$HOME/layr/layr.env" "$HOME/layr/state" "$bt26_power_backup/"
printf 'Management backup: %s\n' "$bt26_power_backup"
sudo -v
python3 deploy/layr preflight --profile kiosk --chromium-backend x11 --dist ./dist
python3 deploy/layr install --profile kiosk --chromium-backend x11 --dist ./dist
layr display-power status
systemctl is-enabled layr-kiosk.service || true
)
```

Stop on a failed preflight/install. Kiosk boot startup must remain disabled. This
does not back up a live Chromium database: retain the previous browser/profile
backup procedure with Chromium closed if making a full tablet backup. Do not
delete or replace its profile to test power management.

1. Start/physically validate `layr switch layr`. Stay on Settings. Confirm ordinary
   touch, remote Moonraker, SSH and text-console recovery before enabling power.
2. Run `layr display-power status`. It must identify the connected i915 backlight
   and a gpio-keys/other KEY_POWER device by its discovered path. Record its normal
   brightness. The owner's BT26 validation established `intel_backlight`, max
   7812, `bl_power` 4/0 and power key events; a different value/name is not assumed.
3. Record a read-only before-state on this BT26:

   ```bash
   cat /sys/class/backlight/intel_backlight/brightness > "$HOME/layr-bt26-brightness-before-power.txt"
   cat /sys/class/backlight/intel_backlight/bl_power
   systemd-analyze cat-config systemd/logind.conf
   systemd-inhibit --list --no-pager
   ```

   Close any earlier experimental backlight/power-button script yourself; do not
   leave two controllers competing or let LAYR kill unrelated processes.
4. `layr display-power configure --idle-minutes 5 --dim --dim-percent 20`, then
   `layr display-power enable`. Read diagnostics/journal; do not infer physical
   success from active systemd. Confirm normal brightness and inhibitor ownership.
5. Stop touching/moving input for four minutes. Verify dim, then at five minutes
   backlight off. From SSH, record brightness, `bl_power`, status and journal.
   Keep observing Wi-Fi/SSH and Moonraker connectivity throughout; no suspend or
   network disconnection is acceptable.
6. Short-press power once: normal brightness must return; it must not shut down or
   toggle dark on release/repeat. Touch/drag/type continuously for over five
   minutes; the screen must stay awake, including held touches and keyboard input.
7. Repeat idle, then run `layr display-power wake` from SSH. It must restore the
   screen without restarting Cage, Chromium, web or printer services. Check a new
   USB keyboard/mouse is recognized; an input failure must restore rather than
   strand the screen dark.
8. Verify `--idle-minutes 1` (dim ~48 s/off ~60 s), `10` (8/10 min), Never (no
   automatic dim/off) and `--no-dim`. Restore the defaults afterwards. Allow full
   intervals; do not simulate rapid hardware power cycling.
9. Stop the kiosk from SSH with `layr stop`: the power controller must stop and
   restore brightness. Restart the known working service preview explicitly;
   power management resumes only if it was previously explicitly enabled.
10. With recovery SSH ready, test a controlled controller crash:

    ```bash
    sudo systemctl kill --kill-whom=all --signal=SIGKILL layr-display-power.service
    systemctl status layr-display-power.service --no-pager || true
    layr display-power status
    ```

    `ExecStopPost` must restore the display with no restart loop. Collect the
    journal. Re-enable only explicitly after checking the failure/recovery.
11. `layr display-power disable --yes`. Verify original brightness/power and that
    the logind configuration is unchanged. It returns the power button to the
    existing system policy. Check `sudo systemctl poweroff` only as a separate,
    deliberate local tablet shutdown test after saving work.

Still to validate on hardware: the service's actual mount/device sandbox, native
Bookworm/i386 evdev ABI/ioctls, logind inhibitor ownership/release, race timing,
hotplug, recovery and boot persistence. Automated FIFO/sysfs fixtures and unit
verification do not certify those. Do not remove sandbox protections or switch
browser/GPU/input drivers to hide an error; report exact logs.

## Diagnostics, recovery and rollback

```bash
layr display-power diagnose --json
sudo journalctl -b -u layr-display-power.service -n 200 --no-pager
systemctl show layr-display-power.service -p ActiveState -p SubState -p Result -p ExecMainStatus
systemd-inhibit --list --no-pager
layr display-power wake
layr display-power disable --yes
```

If the management CLI is broken but the trusted root helper is intact:

```bash
sudo systemctl disable --now layr-display-power.service
sudo /usr/bin/python3 -I /usr/local/lib/layr-display-power/controller.py restore
```

For an unresponsive controller, a targeted kill of **only** that optional unit can
be used after a bounded stop; its stop-post must restore. Never kill all Chromium
processes or user sessions. A stale socket has a validated saved-state recovery
path. Missing/corrupt/untrusted helper or state must be diagnosed before executing
it as root. As a last resort on the **owner-validated BT26 only**, an administrator
can write `0` to `/sys/class/backlight/intel_backlight/bl_power`, then restore the
recorded, range-checked normal brightness. Do not reuse that path on another host.

Disable this feature before rolling back management code. Web-only `layr rollback`
does not remove the root controller. To remove only the optional power component
using its trusted installed helper:

```bash
sudo /usr/bin/python3 -I /usr/local/lib/layr-display-power/controller.py uninstall
```

This restores its backlight, releases the runtime inhibitor and removes its owned
files/unit, leaving LAYR, browser profiles, releases and printer configuration
intact. Do not remove pre-existing administrator logind drop-ins. A later ordinary
uninstall also performs this cleanup. Root/config corruption or removed hardware
can prevent safe automatic restoration; keep the recorded baseline and SSH access
and inspect errors rather than writing an unvalidated device.
