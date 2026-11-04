# Universal installer review and BT26 preparation

Reviewed all uncommitted changes, universal CLI, standalone bootstrap detection and
handoff, deploy helpers, display/engine launchers, units, rollback/uninstall, tests,
CI gates, operator documentation, previous validation and compatibility matrix.
No remote device was contacted. No commit, push, merge, release or deployment was
made; the existing Raspberry Pi installation was not accessed or changed.

## Confirmed defects fixed during review

| Finding | Fix and evidence |
| --- | --- |
| Menu lacked start/stop/restart and display settings | Added numbered SSH/text-console menu with 0 exit; web lifecycle actions; resume only an already-enabled kiosk; active-kiosk restart only; inventory and cursor settings |
| Global CLI followed the invoking HOME | Installed CLI binds to its resolved management directory; owner required for mutations; child scripts receive that installation root |
| Global command never actually exercised by original test | Sandbox redirects only privileged global-link commands, creates a real executable symlink in test PATH, opens its menu through a PTY, repeats installation, and checks uninstall removes it |
| Configure ran APT, created a new release and overwrote rollback history | Connection-only atomic env update, mode 0600; current/previous releases remain unchanged; repair reads authoritative layr.env |
| No remote connectivity gate | Bounded read-only Moonraker server/info API probe; authorization/malformed/unreachable responses fail before installation or configuration; explicit --allow-offline staging |
| Automation could prompt through dpkg or restart services via needrestart | APT uses a noninteractive frontend, keeps existing conffiles and requests needrestart list-only mode |
| No full package dependency preflight | Candidate checks followed by non-mutating APT simulation; simulation and actual installation forbid package removals |
| No dedicated kiosk device/runtime check | Requires systemd, connected DRM connector, VT7 and DRM card; reports CPU/model/graphics/RAM/disk; low disk fails before mutation |
| armhf userland could hide an unsupported ARMv6 kernel | Kernel architecture is reported separately and ARMv6/ARMv5 are rejected before package changes |
| Conflicting VERSION_ID could be accepted through codename | Explicit version takes precedence; a different version is rejected even when codename says Bookworm |
| Empty deploy script could raise an unhandled index error | Complete-script check handles empty/truncated files with a precise error |
| Kiosk chvt ran as the unprivileged browser user | Only chvt ExecStartPre gets systemd's + privilege prefix; browser still has User= owner |
| Boot service could start alongside desktop manager | Unit itself checks active desktop manager, in addition to CLI/switch checks |
| Failed kiosk could activate a previously inactive KlipperScreen | Restoration now requires LAYR's disabled-by-LAYR marker |
| No explicit automatic-start flow | Kiosk installation asks interactively; --autostart opts in for automation using guarded switch only after install succeeds |

## Dependency evidence

Official source inspected over verified HTTPS on 2026-11-03:
`https://deb.debian.org/debian/dists/bookworm/main/binary-i386/Packages.xz`.
All packages below appear in that index; versions are a snapshot, not pins.

| Package | Indexed version | Architecture |
| --- | --- | --- |
| python3 | 3.11.2-1+b1 | i386 |
| curl | 7.88.1-10+deb12u15 | i386 |
| ca-certificates | 20230311+deb12u1 | all |
| cage | 0.1.4-4 | i386 |
| chromium | 150.0.7871.100-1~deb12u1 | i386 |
| libpam-systemd | 252.39-1~deb12u2 | i386 |
| dbus-user-session | 1.14.10-1~deb12u1 | i386 |
| libinput-tools | 1.22.1-1+deb12u1 | i386 |
| kbd | 2.5.1-1+b1 | i386 |
| libgl1-mesa-dri | 22.3.6-1+deb12u2 | i386 |
| libegl1 | 1.6.0-1 | i386 |
| libgbm1 | 22.3.6-1+deb12u2 | i386 |
| nodejs (not a target dependency) | 18.20.4+dfsg-1~deb12u2 | i386 |

The official Node v22.12.0 SHASUMS256.txt was also inspected: it lists Linux x64
archives and no Linux x86 archive. No ARM archive is selected as a fallback.

Node 18 cannot build this project. Build on the workstation with supported Node
and transfer prebuilt assets. Universal installation runs Python and shell only;
it does not install a Node runtime or use architecture-specific Node archives.
APT candidates on the tablet may differ because security/LTS updates, mirrors,
architecture and sources change. No native i386 package execution was performed.

## Architectural limits and unsupported assumptions

- Original bootstrap remains a Raspberry Pi route. The universal entry point is
  `deploy/layr`, with prebuilt assets. They do not yet share one detection/source
  selection implementation. Do not run the Pi-only bootstrap on the BT26.
- Desktop and headless profiles share web-service behavior; desktop browser
  autostart is not implemented. Dedicated kiosk startup is explicit.
- Display/touch settings cover preferred display mode, inventory, cursor setting
  and manual event testing. Arbitrary rotation, touchscreen calibration, multi-GPU
  selection and per-device input mapping are unimplemented. Reject a hardware pass
  if the physical device needs these to work.
- Display-manager and inherited session checks do not fully detect unmanaged
  `startx`/custom compositors from another SSH session. Use a dedicated console
  image; do not test takeover while other graphical sessions run.
- DRM presence, package availability, service status and device-name heuristics
  establish no working graphics or touchscreen. Functional browser/graphics,
  Wi-Fi, orientation, suspend and cold-boot tests remain mandatory.
- Moonraker API reachability does not prove browser-origin authorization, CORS,
  WebSocket access, or an authenticated printer configuration. No auth/CORS files
  are changed by this installer. API-key/token provisioning is not implemented
  in this CLI; authenticated endpoints may fail its probe and need a separately
  reviewed application authorization setup. Never put credentials in the URL.
- Installation is not an OS transaction. Dependencies may remain after failure;
  service/launcher modifications are not included in web rollback. Repair needs
  existing web assets or --dist. Uninstall retains data and packages.
- Global services and command have one owner. Concurrent installs and multiple
  owners are not supported. Backups and exclusive maintenance are required.
- Service health currently checks systemd activity, not stable visual rendering.
  A blank compositor/browser may still appear active. SSH recovery is required.
- The software provides no tablet firmware, Wi-Fi driver or bootloader installer.
  Do not infer 32/64-bit EFI support from the supplied CPU or userspace details.

See [installer-validation.md](installer-validation.md) for test evidence and
[mecer-bt26-test.md](mecer-bt26-test.md) for exact tablet-only commands.

## Files in the final working-tree change

Implementation: `deploy/layr`, `deploy/install.sh`, `deploy/layr-display.sh`,
`deploy/systemd/layr-kiosk.service.in`, `deploy/uninstall.sh`.
The standalone Pi `deploy/bootstrap.sh` and all application source remain unchanged.

Validation: `tests/test_universal_installer.py`, `tests/bootstrap.test.ts`,
`package.json`, `.github/workflows/ci.yml`, `.github/workflows/release-dist.yml`.

Documentation: `README.md`, `docs/universal-installer.md`,
`docs/compatibility.md`, `docs/installer-validation.md`, `docs/installer-review.md`,
`docs/mecer-bt26-test.md`.

The installer is a supervised BT26 test candidate: 35 installer tests and all 393
unit tests pass. Initial browser failures passed in isolation, but clean full
browser CI remains a release gate. No physical compatibility claim or deployment
approval is implied by these files.

## Confirmed BT26 seat failure follow-up

Current findings/fixes and exact device recovery/upgrade instructions are recorded
in [bt26-blank-screen.md](bt26-blank-screen.md). The old generic login PAM setup
and root VT pre-switch did not establish a usable local logind session. The revised
unit requires a dedicated local session and stock authorization, keeping Cage and
Chromium unprivileged. A supervisor separates renderer reaping from PAM helper
ownership and bounds shutdown. This addresses a source-confirmed cleanup hazard;
it is not proof of every cause of the old 90-second delay. Touch detection now
uses actual udev/kernel properties, including i386 ELAN capability bitmaps.

Unverified/incomplete: native target session execution, rendered UI, real touch
interaction, Wi-Fi and cold-boot persistence; rotation/calibration; transactional
rollback of APT and installer code. Web rollback only covers web assets. The
first-error journal and explicit SSH recovery remain essential. See the latest
validation entry for the browser failure and isolated pass; no clean full browser
pass or hardware certification is claimed. All changes remain local.


## Confirmed manual X11 touchscreen result (2026-11-04)

The physical BT26 manual pass now supports choosing Chromium X11 through Cage's
XWayland for this older tablet. The new selection preserves native Wayland as
the default and retains existing saved settings. X11 dependency preflight and
runtime DISPLAY checks fail clearly; no driver, device-permission, root-browser
or sandbox change is involved. Backend changes preserve the browser profile,
Moonraker and releases, disable boot startup and invalidate previous confirmation.
The menu supports both backend choices, Back and repeated actions until Exit.

The service process must reflect the chosen backend before `enable-kiosk` can
accept physical service-based confirmation. Manual success does not prove that
Cage acquired a proper logind/VT session through systemd; this investigation stays
separate. No new session/VT workaround was guessed from the manual result. The
previous local dedicated PAM/session supervisor remains pending physical retest.
See [bt26-x11-upgrade.md](bt26-x11-upgrade.md), the compatibility matrix and the
latest validation results. No current changes have been uploaded or deployed.


## Native photo-picker touch failure

The reported BT26 failure occurs across the HTML file input → Chromium native
Linux dialog boundary, before LAYR receives a file. Upstream Chromium has GTK and
portal picker paths; the exact active toolkit and root cause require device
logs. The recommended local fix is an in-page, cancellable illustration chooser
with three embedded PNGs, retaining explicit native upload for compatible devices.
It reuses the existing bounded compression and scoped storage, changes no kiosk
session or graphics settings, and does not add an arbitrary remote-image path.
See [touchscreen-file-picker.md](touchscreen-file-picker.md). Physical fallback
validation and service/boot validation remain outstanding. No upload/deployment
was performed.
