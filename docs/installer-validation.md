# Universal installer validation — 2026-11-03

The original milestone results below are historical. See the final-review section
for current outcomes and remaining gates.

## Optional Intel display power — 2026-11-04

Latest local validation for the opt-in display-power change:

| Check | Result |
| --- | --- |
| Combined Python installer/power suite | **144 passed** (102 existing plus 42 power tests) |
| Full application unit suite | **397 passed** in 25 files, including **72** Pi bootstrap/deploy regressions |
| Svelte/TypeScript checks | 0 errors, 0 warnings |
| Production frontend build | Passed |
| ShellCheck 0.10.0 and individual Bash syntax checks | Passed, 11 shell scripts |
| Python compilation / Python 3.11 syntax parsing | Passed (execution host Python 3.12.14) |
| Generated unit `systemd-analyze verify` | Passed with a private kiosk dependency stub; no service started |
| Frontend/browser regression evidence | Built frontend bytes match the earlier combined build; prior full browser **354 passed**, authenticated **12 passed**, not rerun for this Python/systemd-only change |
| Native Debian/i386 service sandbox, evdev ioctls and physical timing/recovery | Not run; supervised BT26 validation required |

New tests use private sysfs/input fixtures and subprocesses, never host devices,
APT or systemd mutations. They cover i386/amd64 capability detection, ARM refusal,
non-hardcoded i915 backlights/power input, missing hardware, multi-backlight
selection (including retained CLI selection), 16-/24-byte evdev framing, key/touch
holds, debounce, dim/off timers and cancellation, privileged-path validation,
sudo failures, desktop conflicts, submenu navigation and settings preservation.
FIFO/sysfs integration tests exercise real controller child processes, power-key
and root-socket wake, cancelled/partial requests, kiosk exit, disconnect/hotplug,
SIGTERM restoration, and SIGKILL followed by the same restore function used by
`ExecStopPost`. Unit verification/static assertions establish stop-post linkage;
these are not native PID1 crash recovery or physical GPIO tests.

The controller is installed only after explicit configure/enable, remains off by
default and rejects Raspberry Pi activation. The root-owned isolated helper has
no capabilities, no HOME/network/DRM access, read-only input devices and write
access only to the selected backlight attributes and its own state/runtime. It
uses a temporary low-level `handle-power-key` inhibitor rather than changing
logind configuration; ordinary CLI shutdown remains available. Original brightness
is restored on stop/failure/disable/uninstall. An existing administrator
`HandlePowerKey=ignore` setting is preserved rather than removed.

Commands: `npm run test:installer`, `npm test -- --maxWorkers=1
--testTimeout=60000`, `npm run check`, `npm run build`, ShellCheck and individual
`bash -n` calls. Local sockets/subprocess checks used the environment's execution
network permission; no Node preload was needed. Logs are in
`/workspace/work/layr-display-power/`. Qt was not tested. The BT26 owner-validated
backlight API and manual power wake are distinct from this service's pending
physical validation. See [display-power.md](display-power.md) for exact install,
disable, recovery, rollback and supervised physical tests.

All new power-management changes remain local; the previously uploaded combined
test archive lacks them. No merge, push, release, deployment or live Raspberry Pi
modification was performed for this change.

## Original milestone run

Implementation is uncommitted in the working tree. Nothing was merged or deployed.
No target packages were installed and no host services were changed.

| Check | Result |
| --- | --- |
| New installer suite | 19 passed |
| Existing Pi bootstrap/deployment suites | 69 passed, with runtime workaround below |
| Full existing test suite | 392 passed in 25 files, with runtime workaround |
| Svelte checks | 0 errors, 0 warnings |
| Production build | Passed |
| Shell syntax and diff whitespace | Passed |
| Native target OS installations | Not run |
| Physical hardware validation | Not run |

The installer tests cover named i386, amd64, armhf and arm64 cases, Raspberry Pi
OS/MainsailOS fixtures, profile selection, remote configuration prompts, unsupported
packages/platforms, package failure, display conflicts, port preservation and
recovery. A temporary-home lifecycle test executes the shell installer for fresh
installation, repeat installation, upgrade and web rollback, mocking only privileged
commands and service observations. It also checks that absent KlipperScreen cannot
cause switching to stop the current display.

## Runtime limitation

The environment's Node 24 runtime reports `spawnSync bash EPERM` for captured
synchronous child processes even when the child has completed successfully. A
standalone reproduction returned actual status 0, a positive child PID, stdout
and no signal alongside that error. The initial unmodified regression run had 26
failures attributable to this runtime behavior.

Local validation used an environment-only preload that returns captured stdout
only when the error is EPERM, child status is exactly zero, PID is positive and
signal is null. All nonzero/unknown statuses still throw. This workaround is not
part of the product or CI configuration. The unmodified commands must pass in a
normal CI executor before merge or deployment; the local conditional pass does
not establish that release gate.

Commands:

```sh
npm run test:installer
npx vitest run tests/bootstrap.test.ts tests/deploy.test.ts --maxWorkers=1
npm run verify
```

The Node-based commands used the local preload. Final installer tests ran without
it. The final bootstrap/deployment rerun passed after the shell changes; subsequent
Python-only refinements were covered by the final 19-test installer run.

CI and release workflows now include the installer suite before their existing
test/build gates. Native package installation, systemd sessions, browser behavior,
touchscreens, graphics, Wi-Fi and cold-boot persistence still need the validation
listed in [compatibility.md](compatibility.md). The implementation makes no new
physical tablet compatibility claims.


## Final review and BT26 preparation

- New installer suite: **35 passed**, including actual executable PATH symlink,
  PTY menu, repeat installation and matching uninstall cleanup. All command/unit
  mutations are sandboxed at process boundaries; no host packages/services or
  printer installation were changed.
- New inactive-KlipperScreen fallback regression: **passed**.
- Read-only Bookworm i386 package-index inspection found all required packages;
  no i386 binaries or native systemd kiosk sessions were executed here.
- Python compilation, shell syntax, diff whitespace: passed.
- Svelte checks: 0 errors and 0 warnings.
- Production bundle built successfully.
- Authenticated browser suite: **10 passed, 2 failed**. Both existing
  `thumbnail-cache.spec.ts:14` cases timed out at line 34 expecting 40 blob URLs
  and observing 0, at 1024x600 and 800x480. Authentication fixture key was present
  in the authenticated bundle. Application source and these tests were not
  changed during installer review. This initial failure is retained in the record; isolation results are below. No unrelated thumbnail code was changed.
- Final serial full unit rerun: **393 passed in 25 files**, including **70**
  bootstrap/deployment regression cases (the prior 69 plus the new fallback guard).
  This final run did not use the old Node preload. One worker and the CLI-only
  60-second timeout were used; repository test timeouts remain unchanged.
- Broad browser suite: **250 passed, 8 failed initially**; all **8 failed cases
  passed in a separate one-worker isolation run**. Failures involved motion,
  layout/initial navigation, MMU and print-spool navigation. No application source
  or browser tests were changed to make them pass.
- Authenticated browser isolation: both previously failing thumbnail-cache cases
  **passed** in a separate one-worker run (2/2).
- These retries establish that the failures did not reproduce under isolation;
  they do not establish a clean single full browser run or prove the root cause.
  Keep browser flakiness open for CI before release. All 270 browser cases were
  exercised; 258 broad cases plus 12 authenticated cases. Screenshot-tag-only
  cases were excluded from the broad run as configured in the workspace wrapper.
- Qt is outside the selected product/test acceptance scope, per the owner's
  instruction. No Qt capability is required or claimed for the tablet.

### Current execution conditions

A standalone Node captured-process reproduction succeeds without the old preload
when network permission is enabled for the execution environment. That permission
is also needed for local browser/server sockets. Current clean unit reruns use
that execution permission, no preload, one worker, and a longer CLI test timeout:
`npm test -- --maxWorkers=1 --testTimeout=60000`. During concurrent browser testing,
an existing shell-heavy test exceeded even that timeout; this run is not a clean
pass. Tests were not edited merely to raise timeouts. Report the final results
below; historical passing counts do not override current failures.

The browser suites use the installed system Chromium through work-only Playwright
configuration wrappers. The broad browser run excludes `@screenshot` cases; the
separate authenticated run covers all 12 authenticated cases. Browser results
exercise HTTP/WebSocket fixtures, never the real printer.

Hardware remains unverified. The tablet-only preparation and test commands are in
[mecer-bt26-test.md](mecer-bt26-test.md). Review findings, software fixes and remaining
architectural limitations are in [installer-review.md](installer-review.md).


### Readiness decision

The installer software gates (35 installer tests plus all 393 unit tests, including
70 deploy/bootstrap regressions) pass. It is a **supervised first physical test
candidate**, not a certified hardware installation. Use the tablet-only guide,
back up the tablet image, keep SSH/keyboard recovery available and stop at any
preflight failure. Display rotation/calibration is unimplemented; a tablet that
requires it has not passed compatibility validation.

No native target OS installation or real device validation has occurred here.
No merge, push, release or deployment is authorized by these test results. Obtain
a clean full browser CI run before release. The initial broad browser run used the
historical environment preload; both isolated browser reruns and the final full
unit run used no preload, with execution network permission for local sockets.

## BT26 missing-sudo regression fix

The owner reported a real minimal Debian 12 i386 attempt that passed the old
preflight, reached Moonraker, then failed with `No such file or directory: sudo`
at the first APT operation. That was a missing prerequisite check, not a hardware
compatibility pass.

The local fix uses shared shell privilege validation from the CLI and deployment
helpers. It checks that sudo exists, validates authorization/authentication, and
executes a read-only UID probe that must return 0. CLI installation/preflight and
all privileged lifecycle/recovery dispatch paths validate before their prompts or
mutations. Direct installation, switching, rollback, uninstall and privileged
launcher helpers validate too. Unprivileged status/configuration and existing
standalone shell dry runs retain their previous behavior.

Minimal Debian is supported through the documented one-time `su -` administrator
setup of sudo and the normal user account. Running the whole installer as root
remains rejected to preserve installation ownership. No group-name assumption is
used for validation; an authorized sudoers account outside the sudo group works.
Non-terminal and --yes operation fails without prompting if credentials/access
are unavailable. Command-restricted sudoers policies still need to authorize the
actual deployment commands as well as the UID probe.

Validation after the fix:

| Check | Result |
| --- | --- |
| Universal installer tests | 47 passed (35 existing + 12 privilege regressions) |
| Raspberry Pi/bootstrap/deploy regressions | 70 passed |
| Full Vitest suite | 393 passed in 25 files |
| Python compilation, Bash syntax, diff whitespace | Passed |
| Physical BT26 retest with the fix | Not run |

Commands: `npm run test:installer`, `npx vitest run tests/bootstrap.test.ts
tests/deploy.test.ts --maxWorkers=1 --testTimeout=60000`, and `npm test --
--maxWorkers=1 --testTimeout=60000`. Vitest used execution network permission
needed for the environment's subprocess handling; no Node preload workaround was
used. The fixtures simulate sudo validation/root execution rather than invoking
host privilege escalation. No host APT, systemd or device configuration changes
were performed. Application/browser/Qt code is unchanged; no new Qt validation
was performed.

The standalone Raspberry Pi bootstrap is unchanged. The new privilege validation
moves failures earlier for actual deploy operations while retaining the normal
non-root-user plus sudo installation model and preview-only shell dry runs.

All changes for this fix remain local. Per the owner's latest instruction there
was **no merge, push or deployment**, and the existing `bt26-installer-test`
download bundle is **not updated**. Prepare a new reviewed bundle only after a
subsequent upload authorization. The BT26 guide includes the immediate prerequisite
setup and login verification steps.

## BT26 confirmed seat/session failure follow-up

Owner-provided physical evidence establishes a Cage seat activation denial and an
ELAN1001:00 04F3:2029 direct-touch device. It does not establish a GPU defect or
working touch interaction. The local changes use a dedicated PAM/logind session,
stock Polkit activation, an unprivileged renderer supervisor, bounded shutdown,
udev/kernel touch identification, a persistent CLI menu and web-first installation
with physical confirmation before kiosk boot enablement.

| Check | Latest result |
| --- | --- |
| Universal installer suite | 80 passed |
| Existing Raspberry Pi bootstrap/deploy regressions | 72 passed (included in Vitest total) |
| Full Vitest suite | 395 passed in 25 files |
| Svelte/TypeScript checks | 0 errors, 0 warnings |
| Production build | Passed |
| Full Chromium browser run, including screenshot utility cases | 347 passed, 1 failed out of 348 |
| Single isolated rerun of failed browser case | 1 passed |
| Authenticated browser suite | 12 passed |
| Python compilation, Bash syntax, diff whitespace | Passed |
| Native i386 PAM/logind/VT/DRM session and physical display/input | Not run here; owner retest required |

The broad browser failure was the existing `motion: repeated taps do not queue duplicate commands` case (`e2e/behaviour.spec.ts:297`): two G28 requests were
observed instead of one. It passed the single-worker isolated rerun. No motion
logic was changed to suppress this result. The broad run is not a clean pass;
a clean full browser CI run remains a release gate.

Installer coverage includes all four architectures, fresh/repeated installation,
upgrades, global command executable/removal, missing sudo and insufficient
privileges, root rejection, absent/present KlipperScreen, unreachable Moonraker,
missing packages, web and kiosk phase failure, SSH recovery, menu back/repeat/
cancellation/EOF, udev and 32-/64-bit ELAN input bitmaps, local-session validation,
denied activation, renderer failure exit/stderr, PAM-like sibling ownership and
actual bounded shutdown of a child that ignores SIGTERM. Privileged operations
are isolated fixtures; these tests do not configure this host or the tablet.

Browser tests used system Chromium, a prebuilt isolated preview server and scratch
screenshot output. Execution network permission supported local sockets and
subprocess handling; no historical Node preload was used. Target installations
use prebuilt assets and Python 3.11; Node is not installed on i386. Qt was not
examined. Local logs are under `/workspace/work/layr-bt26-session/` and
`/workspace/work/layr-bt26-fixes/` (not tablet-download URLs).

The upstream systemd 252 PAM/logind/Polkit and Cage 0.1.4 source review is documented
in [bt26-blank-screen.md](bt26-blank-screen.md), including remaining read-only
session/authorization evidence, bounded recovery for the old unit and an in-place
upgrade/installer-code restore sequence. Existing Pi software regressions pass;
no working Pi installation was accessed or changed. Physical compatibility remains
unverified, and no merge, push, release or deployment was performed. The prior
GitHub test archive is unchanged and must not be used as the updated build.


## Configurable Chromium backend follow-up (2026-11-04)

The owner reports a physical BT26 manual Cage + Chromium X11/XWayland rendering
and ELAN touch pass; native Chromium Wayland rendered but touch failed. This is
separate from the unresolved systemd/logind/VT service and boot validation.

The local change adds strict `LAYR_CHROMIUM_BACKEND=wayland|x11` handling, saved
selection and CLI/menu controls, XWayland candidate/simulation/installation and
runtime checks, configured/running backend diagnostics, and backend-scoped
service-based physical confirmation. Existing profile, Moonraker and release
history are retained. ARM's unset/default launch remains native Wayland. Fresh
interactive x86 kiosk setup recommends X11 for older Intel tablets; unattended
setup retains saved/default selection unless explicitly overridden.

| Check | Result |
| --- | --- |
| Universal installer tests | 102 passed |
| Full Vitest suite | 395 passed in 25 files |
| Raspberry Pi/bootstrap/deploy regressions | 72 passed (included in Vitest total) |
| Svelte checks and production build | Passed; zero check errors/warnings |
| ShellCheck 0.10.0, `-x -S warning deploy/*.sh` | Passed |
| Python compilation, Bash syntax, diff whitespace | Passed |
| Full Chromium browser suite, including screenshot cases | 348 passed |
| Authenticated browser suite | 12 passed |
| Native service startup / physical boot test with this build | Not run; requires BT26 retest |

New coverage executes the actual launcher against isolated Cage/browser
boundaries, checking native Wayland flags without XWayland, X11 flags and Cage's
own DISPLAY, missing dependencies, invalid values, no inherited unrelated X
server, and preserved profile/release/remote URL. Installer coverage includes
armhf, arm64, i386, amd64, Intel recommendation and explicit Wayland, saved/CLI/env
precedence, preflight failures, backend changes without release mutation,
privilege failures, cancellation/dry run, and invalidated physical confirmation.
Service backend evidence is read from the service process, not the caller's
environment. A real global-command PTY test repeats status actions and uses Back
before Exit; unit menu tests also cover both backend selections and return paths.

The tests use isolated package/service fixtures and scratch browser artifacts.
No host APT install, tablet/Pi access or deployment occurred. ShellCheck was
unpacked only into the test workspace. No Node preload or Qt tests were used.
Commands: `npm run test:installer`, `npm test -- --maxWorkers=1
--testTimeout=60000`, `npx vitest run tests/bootstrap.test.ts tests/deploy.test.ts
--maxWorkers=1 --testTimeout=60000`, `npm run check`, `npm run build`, plus the full
Playwright configurations in `/workspace/work/layr-chromium-backend/` using the
system Chromium and isolated preview servers. See
[bt26-x11-upgrade.md](bt26-x11-upgrade.md) for the in-place update and recovery.
No merge, push, release or deployment is authorized by these results.


The fresh full browser run passed all 348 cases with one worker, including the
previously failing motion duplicate-command case, without an isolated rerun.
Authenticated cases passed all 12. These local browser results supersede the
previous entry's unclean broad run; they do not substitute for native Cage,
XWayland, touch or service/boot validation on the target. Logs and exit statuses
are retained under `/workspace/work/layr-chromium-backend/`. The initial new
service-environment fixture exposed an exec-readiness race under concurrent test
load; it now waits for an explicit child ready signal, and production readiness
treats an empty process environment as unverified. The final installer run passed
all 102 tests after that correction.

## Touchscreen native file-picker fallback

The BT26 owner reports working LAYR touch under Cage/Chromium X11, followed by an
unresponsive native Linux image picker. Local code review locates the boundary
at the HTML file input; Chromium's upstream GTK and portal implementations do
not establish which one the installed package uses. No precise toolkit cause or
XWayland exclusivity is claimed. The implementation adds an in-page cancellable
chooser with three original, embedded PNG illustrations and retains explicit
native upload behind a warning. It changes no installer, service or input setup.

The illustration File passes through the unchanged 8 MiB raster-file policy,
JPEG compression (1024 px / 400 KiB), scoped IndexedDB and eight-printer eviction
rules. Existing photos remain intact. Arbitrary image URLs are not introduced.

| Check | Result |
| --- | --- |
| Full Vitest suite | 397 passed in 25 files, including 72 bootstrap/deploy regressions |
| Printer-image unit tests | 15 passed |
| Targeted printer-image and Settings browser tests | 48 passed |
| Universal installer tests | 102 passed |
| Svelte checks / production build / diff whitespace | Passed; zero check errors/warnings |
| Full browser suite, including screenshot cases | 354 passed |
| Authenticated browser suite | 12 passed |
| Native GTK/portal touch and updated physical BT26 fallback | Not exercised in this environment |

Touch tests at both kiosk viewport sizes cover all illustrations offline, zero
filechooser events on the fallback path, explicit Apply, cancellation without
writes, Escape/focus return, usable touch targets, persistence and quota failure
without losing the previous image. Native upload and cancellation are tested via
Playwright's intercepted filechooser API; this is not native-dialog touch testing.
Existing format/size/thumbnail/scope/removal regressions remain unchanged.

Tests use system Chromium and isolated preview/output directories under
`/workspace/work/layr-picker/`. Scratch screenshots are not written into the
repository documentation. No physical tablet/Pi, host service or package state
was modified. No merge, push, release or deployment was performed. The limitation,
read-only device diagnostics and physical retest steps are documented in
[touchscreen-file-picker.md](touchscreen-file-picker.md).


The final full browser run passed all 354 cases without retries (including six
new chooser cases) in 6.9 minutes; the authenticated suite passed all 12. No
isolated rerun was needed. The final built app and both chooser screenshots were
reviewed, including the 800×480 Cancel/navigation layout. Browser package/display
integration on the physical BT26 remains outside this automated environment.
