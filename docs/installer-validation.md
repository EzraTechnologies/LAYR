> Historical review snapshot. The user subsequently authorized uploading the prebuilt bundle to the separate bt26-installer-test branch. Main and the Raspberry Pi installation remain unchanged.

# Universal installer validation — 2026-11-03

The original milestone results below are historical. See the final-review section
for current outcomes and remaining gates.

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
