# Raspberry Pi checks for this change

These steps are for a person at the printer, after the pull request is reviewed and approved.
Nothing in this file was executed on a Raspberry Pi, a BTT HDMI7, or a Voron Trident.
Do not treat a green CI run as a hardware pass.

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
  `layr-display.sh to-layr`, install leaves it enabled and does not restart it. The refreshed
  launcher is used the next time that unit starts. Install does not stop KlipperScreen
  and does not edit `printer.cfg` or `moonraker.conf`.

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
This path was not confirmed on a BTT HDMI7 in development. If the arrow remains, say so
in the pull request; do not ignore the touch device in libinput.

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
`./deploy/uninstall.sh`. That still does not edit `printer.cfg` or `moonraker.conf`.
