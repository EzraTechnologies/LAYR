# Combined Mecer BT26 test build — 0.2.0-20261104.1

This is the current combined test build, uploaded with the owner's permission.
It includes the universal installer/X11/menu/session work **and** the touch-friendly
printer-image chooser with three bundled illustrations. The tested archive is
unchanged from the reviewed local artifact. Nothing is merged or deployed, and
no GitHub release is created.

## Download

This repository is private. Sign into GitHub with an account that can access
`EzraTechnologies/LAYR`, then download these files from their GitHub pages:

- [Combined archive](https://github.com/EzraTechnologies/LAYR/blob/bt26-installer-test/bt26-test/0.2.0-20261104.1/layr-bt26-test-0.2.0-20261104.1.tar.gz) — use **Download raw file**.
- [Archive checksum](https://github.com/EzraTechnologies/LAYR/blob/bt26-installer-test/bt26-test/0.2.0-20261104.1/layr-bt26-test-0.2.0-20261104.1.tar.gz.sha256) — save with the same filename.
- [Full backup, extraction, install, recovery and rollback instructions](https://github.com/EzraTechnologies/LAYR/blob/bt26-installer-test/bt26-test/0.2.0-20261104.1/INSTALL-BACKUP-ROLLBACK.md).
- [Test results and compatibility limits](https://github.com/EzraTechnologies/LAYR/blob/bt26-installer-test/bt26-test/0.2.0-20261104.1/TEST-RESULTS.md).

Anonymous raw URLs/curl can return 404 for this private repository. Do not paste
access tokens into URLs or chat. Browser download followed by SCP is sufficient;
GitHub CLI/Node/npm are not needed on the tablet.

**Use the versioned archive.** The branch's root `deploy/` and `src/` are older
source and are not the source of this combined build. Do not run `git pull` or
download main's bootstrap expecting these latest changes. The archive's manifests
identify its frozen uncommitted source snapshot and paired installer/frontend.
The older `layr-bt26-review.tar.gz` is historical and lacks these fixes.

SHA-256:

```text
a1d60df305df50bddae83512cf62c8d2fabfc288560514cbd46afebc545580ed
```

## Transfer to the tablet

From the computer holding the downloaded archive/checksum, use Bash:

```bash
read -r -p 'BT26 tablet SSH IP/hostname (NOT the printer): ' bt26_host
scp layr-bt26-test-0.2.0-20261104.1.tar.gz layr-bt26-test-0.2.0-20261104.1.tar.gz.sha256 "karel@${bt26_host}:~/"
ssh -t "karel@${bt26_host}"
```

Use the tablet owner's actual username if it is not `karel`. Do not use the
remote Moonraker printer's address as the SCP/SSH destination.

## Verify, back up, then install

On the tablet as the normal owner:

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
)
```

**Before installing:** open the extracted `README-BT26.md` and complete its
**Stop the old kiosk and preserve configuration/data** section. Close manual
Cage/Chromium first; retain the actual working Chromium profile. That section
provides a bounded stop for the old hanging unit and saves the original tools,
config, units, state, release pointer and closed browser profile. Do not skip it.

Then, after the backup succeeds:

```bash
(
set -e
cd "$HOME/layr-test-builds/layr-bt26-test-0.2.0-20261104.1"
sudo -v
python3 deploy/layr preflight --profile kiosk --chromium-backend x11 --dist ./dist
python3 deploy/layr install --profile kiosk --chromium-backend x11 --dist ./dist
cmp "$HOME/layr/management/bt26-build.json" "$HOME/layr/current/bt26-build.json"
layr status
)
```

No `--moonraker` override is used: the saved endpoint and web port are retained.
The browser profile, printer preferences and image storage are not reset. Existing
releases remain. No printer configuration is edited, no KlipperScreen installed,
and kiosk boot startup stays disabled. There is no Debian reinstallation.

## Physical preview and recovery

Only with keyboard/SSH recovery ready, and the old manual compositor closed:

```bash
layr switch layr
layr status
layr kiosk-diagnose
```

Verify a **service-launched** rendered UI, real ELAN touch, menu Back/return paths,
remote connection, the in-page illustration chooser/Cancel, and SSH/console
recovery. An active unit or earlier manual launch is insufficient. Test saving
illustrations only after backing up any current photo that must be retained.

On failure, leave boot startup disabled:

```bash
layr recover
sudo chvt 1
layr kiosk-diagnose
```

Only after the service display/touch/recovery checks pass, use `layr enable-kiosk`
and its explicit physical confirmation. Cold boot/Wi-Fi persistence is a later
supervised test. No automatic enablement is part of these commands.

## Rollback

`layr recover` then `layr rollback --yes` restores the last recorded **web** release
only. After repeat installs that may be another test release. Use the full
backup-based rollback section in `INSTALL-BACKUP-ROLLBACK.md` / extracted
`README-BT26.md` for the original installer, units, env and saved release pointer.
Keep the old kiosk disabled. Browser data is retained, not automatically restored;
APT packages are not purged or downgraded.

## Test evidence and limits

- 102 installer tests passed.
- 397 unit tests passed, including 72 Raspberry Pi/bootstrap/deployment regressions.
- 354 browser and 12 authenticated browser tests passed.
- Build, Svelte checks, ShellCheck, syntax and extracted payload checks passed.
- ARM's default browser backend remains Wayland; the live Pi was untouched.

The owner's prior **manual Cage + Chromium X11/XWayland** rendering and ELAN touch
pass is documented. This combined build, the systemd seat/VT path, new chooser
flow and cold-boot/Wi-Fi persistence still require physical BT26 testing. Native
Linux file-picker touch is not fixed: use bundled illustrations for touch-only
operation; native upload requires a keyboard/mouse backup. Rotation/calibration
and other hardware remain unverified. Qt is not required/tested.
