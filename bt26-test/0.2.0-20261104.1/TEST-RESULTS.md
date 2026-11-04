> These results describe the frozen build and test stage. The unchanged archive was subsequently uploaded to the test branch with the owner's explicit permission. No source merge, release or deployment occurred.

# Combined BT26 test results — layr-bt26-test-0.2.0-20261104.1

Both changes are included in this one unpublished test archive. All checks below
ran against the same frozen uncommitted source snapshot, not independently built
installer and frontend copies. No merge, commit, push, release or deployment was
performed. No working Raspberry Pi or physical tablet was accessed.

- Git base: `6c92f086bcde6adc6ab21451a593946976cab810`
- Source revision SHA-256: `017d44347eb963c92c78e787ab7244d1bd62401c6d9e1c9f9a65aef2731c7eca`
- Source files: 363; raw-source provenance in `SOURCE-MANIFEST.json`.
- Installer/frontend identity: `deploy/bt26-build.json` equals `dist/bt26-build.json`.
- The source snapshot and current working tree were compared again before packaging.
- The delivered runtime files were compared byte-for-byte with the tested snapshot.
- Source is uncommitted; the source fingerprint identifies the changes beyond Git HEAD.

| Check | Result |
| --- | --- |
| Svelte/TypeScript checks | 0 errors, 0 warnings |
| Universal installer tests | 102 passed |
| Full Vitest suite | 397 passed in 25 files |
| Raspberry Pi bootstrap/deployment regressions | 72 passed, included above |
| Full browser suite, including screenshot utilities | 354 passed, no retries |
| Authenticated browser suite | 12 passed, no retries |
| Production frontend build | Passed |
| ShellCheck 0.10.0 (`-x -S warning`) | Passed for all deployment shell scripts |
| Bash syntax | Passed individually for all 11 scripts and 9 guide blocks |
| Python compilation | Passed |
| Python 3.11 syntax compatibility | All 4 deployment Python entrypoints parsed |
| Runtime payload, paired identity and asset references | Passed |
| Native Debian/Pi install or physical display/touch/boot | Not run here |

Node: v24.19.0; npm: 11.9.0; Python: Python 3.12.14.
Browser: Chromium 154.0.8037.57 built on Debian GNU/Linux 13 (trixie). Bookworm's Python 3.11 was syntax-checked but not
executed natively: this cloud run uses Python 3.12. No historical Node preload was
used. Execution network permission enabled local browser sockets/subprocess tests.
Target installations use prebuilt web assets and system Python, not Node binaries.

Commands: `npm run check`; `npm run test:installer`; `npm test -- --maxWorkers=1
--testTimeout=60000`; `npm run build`; full Playwright base/auth configurations with
system Chromium, one worker and separate preview servers. The ordinary production
build is delivered; the authenticated fixture-key build is isolated and excluded.
Exact configurations/check records and raw logs are under `TEST-LOGS/`. Screenshots
there depict synthetic browser touch tests, not physical BT26 results.

Installer tests use isolated APT/sudo/systemd boundaries. They cover i386, amd64,
armhf and arm64, root/privilege failures, fresh/repeat/upgrade/rollback flows,
optional KlipperScreen, remote/offline Moonraker, global CLI permissions/removal,
menu repetition/Back/cancellation, X11 dependencies, service-session validation,
nonzero Cage failures, bounded stop and boot-startup guards. ARM keeps Wayland by
default; the live Pi installation was not modified. Browser tests include offline
illustration selection, zero native dialogs on that path, Cancel/Escape, native
upload interception, image type/size/storage restrictions and quota preservation.

## Compatibility and physical limits

| Platform/configuration | Automated result | Physical result |
| --- | --- | --- |
| Debian 12 i386 | Detection/backend/lifecycle contracts passed | BT26 owner previously passed manual Cage/X11 web rendering and ELAN touch; this archive untested |
| Debian 12 amd64 | Detection/backend/lifecycle contracts passed | Untested |
| Pi Bookworm armhf/arm64 | Contracts plus existing Pi regression suite passed | Not tested in this milestone; working Pi untouched |
| BT26 native Chromium Wayland touch | No native test here | Owner reports rendered UI without working touch |
| BT26 native Linux file picker under X11 setup | Upload API interception tested, not native touch | Owner reports touch cannot navigate/cancel; toolkit/portal cause unconfirmed |
| New in-page image chooser | Both kiosk sizes pass browser touch/offline/cancel tests | Awaiting physical test |
| Service/VT startup and automatic boot | Isolated session/stop/confirmation tests passed | Awaiting physical validation |

Use `README-BT26.md` as the authoritative transfer/upgrade/rollback guide for this
combined version; supporting per-change docs may describe older archive names.
The workspace path is not a public download or SSH host. Do not SCP to the printer.
No automated test result authorizes enabling kiosk boot startup. Keep it disabled
until the explicit service-based physical flow succeeds, then separately verify
cold boot, Wi-Fi persistence and recovery. No root Chromium, blanket device chmod,
sandbox disablement, KlipperScreen installation or printer configuration change
is part of the test procedure. Native file-picker touch is not claimed fixed.

Saving an illustration intentionally replaces the active printer's image; Cancel
does not. Use the closed-browser backup before Apply/removal tests if the current
photo must be retained. Normal upgrade and rollback retain Chromium/printer data;
profile restoration is never automatic. A one-step `layr rollback` selects the
last recorded release, which may be another test install after repetition. Use
the saved pre-test release/full-restore instructions for a known baseline. APT
packages remain installed after code/unit rollback. Rotation/calibration and
additional hardware models remain unverified. Qt is intentionally not tested.
