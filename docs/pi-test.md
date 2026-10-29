# Raspberry Pi checks for this change

These steps are for a person at the printer, after the pull request is reviewed and approved.
Nothing in this file was executed on a Raspberry Pi, a BTT HDMI7, or a Voron Trident by the
change that added sections 7 and 8. Do not treat a green CI run as a hardware pass.
Sections 7 and 8 are the hardware checks for the release-specific kiosk URL and the opt-in
`vc4-hdmi` pointer rule.

None of the commands below restart Klipper or Moonraker. `systemctl restart layr-kiosk`
and `layr-engine.sh --restart-kiosk` restart only the LAYR display process.
`layr-display.sh to-klipperscreen` stops the LAYR kiosk and starts KlipperScreen.
It does not restart Klipper.

## 1. Get the reviewed build

Wait until the pull request is approved. Then, on the Pi, as the printer user (not root):

```bash
cd ~/LAYR
git fetch origin pull/<PR>/head:layr-pr-<PR>
git checkout layr-pr-<PR>
npm ci
npm run build
```

Replace `<PR>` with the pull request number. Keep the existing `~/layr` directory.
That is where the installed release, `layr.env`, and the Chromium profile live.

## 2. Install without switching the panel

From `~/LAYR` (the repository), a relative dist path must work:

```bash
./deploy/install.sh --dist ./dist --yes
```

An absolute path also works: `--dist "$PWD/dist"`. With no `--dist`, the script uses
the `dist/` directory next to `deploy/`.

What this does:

- Copies `dist/` into a new `~/layr/releases/<timestamp>` and points `~/layr/current` at it.
- Refreshes `~/layr/bin/` (`layr-kiosk.sh`, `kiosk-lib.sh`, `layr-engine.sh`, and the cursor helpers).
- Rewrites `LAYR_PORT` and `LAYR_MOONRAKER_URL` in `~/layr/layr.env` and keeps other keys,
  including `LAYR_KIOSK_ENGINE` and `LAYR_HIDE_CURSOR`.
- Restarts `layr-web.service` only if that unit was already active, so the new files are served.
- Leaves `layr-kiosk.service` disabled on a first install. If you already enabled it with
  `layr-display.sh to-layr`, install leaves it enabled and does not restart it unless you pass
  `--reload-kiosk`. That flag restarts `layr-kiosk.service` only when the unit is already active.
  It does not start a disabled kiosk. The refreshed launcher is used the next time that unit starts.
  Install does not stop KlipperScreen and does not edit `printer.cfg` or `moonraker.conf`.
- Does not write a udev rule unless you pass `--ignore-hdmi-pointers`. See section 8. Without that
  flag, a rule already installed on the Pi is not read or changed.
- The next kiosk start opens `/?moonraker=...&layr_build=<release directory name>#/home`.
  `layr_build` is the basename of `~/layr/current` (the timestamp directory this install created).
  Rollback points `current` at the previous directory, so the value changes back.

`./deploy/rollback.sh` points `~/layr/current` back at the previous release. It does not
replace the launcher in `~/layr/bin`. Run install again if you need the previous launcher.

## 3. Browser checks before the kiosk

Open Chromium on the Pi:

```text
http://127.0.0.1:7180/?moonraker=http://localhost:7125#/home
```

Work through [trident-checklist.md](trident-checklist.md). For this change, confirm:

- While printing, Speed is Klipper's live mm/s and Flow is live mm³/s. They are not the
  M220/M221 percentages. The label says the values are reported by Klipper.
- Pause, a stopped extruder, and a retract behave as the checklist describes.
- The active G-code thumbnail appears, including a file in a subfolder. A file with no
  thumbnail shows the placeholder. Progress, ETA, layers, temperatures, and print actions
  stay usable at the panel's real size (1024×600 or 800×480, or whatever `check-device.sh` reports).
- Tapping the Z height still opens Move for Z offset. There is no Fine Tuning page.
- Tapping Speed or Flow opens a small percentage adjuster. The dashboard readout stays mm/s and mm³/s.
- Settings can save a display name such as "Voron Trident". `hostname` is still `mainsailos`
  (or whatever it already was). Clearing the name shows the Klipper host name again.

The display name and Hide pointer are stored in the browser profile (`localStorage`), not in Linux.

## 4. Hide pointer, only if the kiosk is already how you want to test it

Do this only after the browser checks, and only if LAYR is already the display.
Do not disable the touchscreen.

In Settings, turn Hide pointer on, then restart only the kiosk:

```bash
sudo systemctl restart layr-kiosk
```

The arrow should be gone, touch should still work, and a physical mouse should still click.
Turn Hide pointer off and restart `layr-kiosk` again: the mouse cursor should be visible.
On a Pi 4 with Cage 0.2.0 and a BTT HDMI7, Hide pointer alone left a cursor from `vc4-hdmi-0`
and `vc4-hdmi-1`. Do not ignore the touchscreen or a USB mouse. If the arrow remains, use
section 8, which matches only those `vc4-hdmi` pointing sticks.

## 5. Optional WPE experiment

WPE is off unless you save it. Chromium stays the default. This does not install packages
and does not change boot or the KlipperScreen fallback.

Debian Bookworm's `cog` package is 0.16.1 and uses WPE WebKit (`libwpewebkit`), not WebKitGTK.
Bookworm does not ship security updates for `wpewebkit`. Do not upgrade it from another suite.
LAYR will not run `apt` for you.

```bash
./deploy/layr-engine.sh check
./deploy/layr-engine.sh status
```

`check` must say plainly when `cog`, `libwpewebkit-1.1-0`, the Wayland platform plugin,
or Cage is missing. A missing package is a failed check, not a silent switch.

If `check` exits 0 and you want to try WPE:

```bash
./deploy/layr-engine.sh use wpe --yes
```

That only writes `LAYR_KIOSK_ENGINE=wpe` in `~/layr/layr.env`. The picture does not change
until the kiosk starts again. To switch the running display, and only then:

```bash
./deploy/layr-engine.sh use wpe --yes --restart-kiosk
```

`--restart-kiosk` restarts `layr-kiosk.service` only.

The WPE process is Cog inside Cage (`cog --platform=wl` or `fdo` when `wl` is absent),
full screen, with its own website data under `~/.cache/layr-wpe` and
`~/.local/share/layr-wpe`. That store is not the Chromium profile, so a display name or
Hide pointer saved in Chromium is not visible in WPE until you set it again.
The Moonraker URL is on the page query string, so the socket does not depend on Chromium storage.
Cog's DRM/KMS plugin is not launched.

If Cog or its Wayland plugin is missing at startup, the kiosk logs that and starts Chromium
for that session. The saved engine stays `wpe` until you roll it back. `use wpe` itself
refuses to save WPE when `check` fails.

Logs and status:

```bash
./deploy/layr-engine.sh status
journalctl -u layr-kiosk -u layr-web --since "10 min ago" --no-pager
```

`layr-web` is the static file server. `layr-kiosk` is the display. Neither unit is Klipper.

## 6. Back to Chromium, then to KlipperScreen

One command saves Chromium again. Add `--restart-kiosk` only if the panel should switch now:

```bash
./deploy/layr-engine.sh rollback --yes
# or, to apply it on the panel:
./deploy/layr-engine.sh rollback --yes --restart-kiosk
```

`use chromium --yes` is the same save. Confirm `status` shows `saved-engine: chromium`.

To give the panel back to KlipperScreen:

```bash
./deploy/layr-display.sh to-klipperscreen --yes
./deploy/layr-display.sh status
```

KlipperScreen stays installed either way. Uninstall, if you want the LAYR units gone, is
`./deploy/uninstall.sh`. That still does not edit `printer.cfg` or `moonraker.conf`, and it does
not delete `/etc/udev/rules.d/99-layr-ignore-hdmi-pointers.rules`.

## 7. Release URL and a kiosk reload

Do this only after the pull request is approved, and only on the Pi you mean to test.
Back up the launcher that is running today before install replaces `~/layr/bin`:

```bash
mkdir -p ~/layr-local-backup-20261028
cp -a ~/layr/bin/layr-kiosk.sh ~/layr-local-backup-20261028/ 2>/dev/null || true
if [ -f /etc/udev/rules.d/99-layr-ignore-hdmi-pointers.rules ]; then
  sudo cp -a /etc/udev/rules.d/99-layr-ignore-hdmi-pointers.rules ~/layr-local-backup-20261028/
fi
```

Install from the reviewed tree (section 2) **without** `--reload-kiosk` first. Confirm:

- `readlink -f ~/layr/current` is a new `~/layr/releases/<timestamp>` directory.
- `systemctl is-active klipper` and `systemctl is-active moonraker` are unchanged.
- If the kiosk was already running, it is still the old process until you reload it.
  `journalctl -u layr-kiosk -n 20 --no-pager` does not yet show the new `layr_build`.

Reload only the display:

```bash
sudo systemctl restart layr-kiosk
```

Or, on a later install, `./deploy/install.sh --dist ./dist --yes --reload-kiosk`.
That restarts `layr-kiosk.service` only when it is already active.

Then confirm:

- `journalctl -u layr-kiosk -n 40 --no-pager` contains `Kiosk page:` and
  `layr_build=<that timestamp>`.
- The Moonraker value is still the URL from `~/layr/layr.env`. The hash is `#/home`.
- In Chromium, the loaded script matches the new release. From the Pi:

```bash
basename "$(readlink -f ~/layr/current)"
grep -o 'assets/index-[^"]*' ~/layr/current/index.html
```

  The page should be running that script, not the previous `index-*.js`.
- A display name and Hide pointer saved earlier are still there.
- `./deploy/rollback.sh --yes` does not restart the kiosk. After
  `sudo systemctl restart layr-kiosk`, `layr_build` is the previous release directory name
  and the page is that older bundle. `./deploy/rollback.sh --yes` again returns to the new one.
  `--reload-kiosk` may be used instead of the manual `systemctl restart`.
- Klipper and Moonraker were not restarted. A print that was running is still the same job.

To put the previous launcher back without using this tree:

```bash
cp -a ~/layr-local-backup-20261028/layr-kiosk.sh ~/layr/bin/layr-kiosk.sh
sudo systemctl restart layr-kiosk
```

## 8. Opt-in vc4-hdmi pointer rule

Skip this section if Hide pointer already removed the arrow and touch still works.
The rule is not installed by `install.sh` unless you pass `--ignore-hdmi-pointers`.
Default is to change nothing.

On the Pi 4 these two inputs are virtual pointing sticks (`ID_INPUT_POINTINGSTICK=1`) and also
keys (`ID_INPUT_KEY=1`). The BTT panel is a different device (`ID_INPUT_TOUCHSCREEN=1`).
Ignoring the HDMI devices also ignores HDMI-CEC buttons that arrive on them.

Read only:

```bash
./deploy/layr-hdmi-input.sh status
```

`mitigation-offered` is `yes` only when a name matching `vc4-hdmi-<digits>` is a pointing stick.
`BIQU BTT-HDMI7`, a USB mouse, and a `vc4-hdmi` device that is only a keyboard must say
`phantom-hdmi-pointer: no`. If nothing matches, stop. Do not write a rule.

Preview, then apply only if the list is the HDMI sticks you expect:

```bash
./deploy/layr-hdmi-input.sh apply --dry-run
./deploy/layr-hdmi-input.sh apply
```

The prompt is the opt-in. Unattended provisioning uses `apply --yes` or
`./deploy/install.sh --ignore-hdmi-pointers --yes`. `--yes` on install alone does **not**
opt in; the HDMI flag is required.

A file already at `/etc/udev/rules.d/99-layr-ignore-hdmi-pointers.rules` that LAYR did not write,
including the hand-installed two-line rule from the 2026-10-28 Pi test, is left byte-for-byte
alone. `remove` refuses to delete that file. To retire it, move it aside yourself after copying
the backup from the start of section 7.

If apply writes a LAYR-managed rule, it reloads udev and triggers only the matching event nodes.
The rule text matches by `ATTRS{name}`, not by `eventN`. Then:

```bash
sudo systemctl restart layr-kiosk
```

`apply --restart-kiosk` does that same kiosk restart when the unit is already active.
Check on the panel:

- The ghost pointer is gone.
- The BTT touchscreen still taps.
- A physical mouse still moves and clicks, if one is plugged in.
- HDMI-CEC buttons on `vc4-hdmi-0` / `vc4-hdmi-1` do not. That is the warned tradeoff.
- `systemctl is-active klipper` and `systemctl is-active moonraker` are unchanged.

Reboot and confirm the rule is still present and the pointer stays gone:

```bash
test -f /etc/udev/rules.d/99-layr-ignore-hdmi-pointers.rules && echo persists
./deploy/layr-hdmi-input.sh status
```

Roll the LAYR-managed rule back:

```bash
./deploy/layr-hdmi-input.sh remove
sudo systemctl restart layr-kiosk
```

The HDMI pointing sticks are visible to libinput again. Touch and the mouse stay as they were.
`./deploy/layr-hdmi-input.sh restore` puts back the last removed LAYR copy. It does not recreate
a hand-written file. `./deploy/uninstall.sh` also leaves the rule file where it is.

## 9. Raspberry Pi reboot and shutdown

This section is a manual check for Settings → Reboot Raspberry Pi and Shut down Raspberry Pi.
CI does not run it. The change that added the buttons was not executed on a Pi, and it does not
reboot or power off any machine by itself. Do not start this section unless you mean to restart
or shut down the Pi you are looking at. The full checklist is [pi-host-controls.md](pi-host-controls.md).
