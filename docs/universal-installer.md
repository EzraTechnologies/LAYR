# Universal terminal installer

Run the reviewed checkout's `python3 deploy/layr` as the intended desktop/printer
user, with sudo access. The original standalone `deploy/bootstrap.sh` remains the
Raspberry Pi installation route with its existing safeguards. The universal entry
point uses prebuilt web assets; it does not install Node, Klipper, Moonraker,
KlipperScreen, or the experimental native Qt/WPE components. This avoids trying to
install an unsupported Node toolchain on i386.

Build assets on a workstation with the repository's required Node version:

```sh
npm ci
npm run build
python3 deploy/layr install --dist ./dist
```

The terminal menu and installation prompts work over SSH. Select a profile
independently of hardware:

| Profile | Behavior |
| --- | --- |
| headless | Loopback web server, global management CLI; no kiosk service changes |
| desktop | Same service behavior; open the preview in the existing desktop browser |
| kiosk | Installs Cage/Chromium dependencies and a disabled dedicated tty7 service |

A Pi can use remote Moonraker. An Intel tablet can connect to local Moonraker.
Neither architecture selects a profile. No profile installs KlipperScreen.
Existing kiosk services are left untouched by headless/desktop installs; changing
profiles does not implicitly stop a running kiosk. Use `layr recover` first when
retiring a dedicated kiosk.

For automation, supply all configuration explicitly:

```sh
python3 deploy/layr install --profile headless --moonraker http://printer.local:7125 --dist ./dist --dry-run --yes
python3 deploy/layr install --profile kiosk --moonraker http://192.168.1.50:7125 --dist ./dist --yes
layr diagnose
layr switch layr --yes
```

Kiosk activation is a separate explicit command. An active desktop display manager
blocks a dedicated kiosk switch. No desktop packages, autologin, display-manager
configuration, HDMI modes, Wi-Fi settings or boot files are changed. A missing
KlipperScreen unit blocks switching to it before stopping the current kiosk.
The original switcher's health checks and automatic KlipperScreen fallback remain.
The optional WPE/native Qt prototypes retain their separate opt-in workflows and
are outside this milestone's platform support.

The global `/usr/local/bin/layr` command points to persistent management scripts in
`~/layr/management`. Another installation's command is not overwritten. This is a
single-owner system installation, matching the existing system service model.
Python 3 and working Bookworm APT repositories are prerequisites. Dry runs do not
refresh APT metadata or write configuration; stale/missing candidates produce an
explicit error. Resolve repository configuration yourself, then rerun. APT failure
stops installation; already installed dependencies can remain after failure.

The Moonraker prompt accepts an IP, hostname, or full HTTP(S) URL. Credentials,
paths and query strings are rejected. Remote Moonraker must permit the browser's
origin through its existing authorization/CORS settings. The installer never
modifies the printer's configuration. The web server remains loopback-only; from
SSH use `ssh -L 7180:127.0.0.1:7180 user@device` for preview.

## Maintenance and recovery

```sh
layr update --dist /path/to/reviewed/dist --yes
layr configure --moonraker http://printer.local:7125 --yes
layr repair --yes
layr rollback --yes
layr recover --dry-run
layr recover
layr switch klipperscreen --yes  # only if already installed
layr uninstall --yes
```

Updates require a reviewed prebuilt directory; no unattended Git branch tracking
or downloads occur. Repair reuses installed assets, the saved profile and the endpoint in layr.env.
Configure updates only the Moonraker setting; it does not run APT, create a release
or replace the previous-release record. Profile changes use install --profile. After a legacy bootstrap install, supply `--profile`, `--moonraker` and
`--dist` once to establish universal CLI state. If current assets are missing,
repair needs `--dist`. No automatic kiosk restart occurs.

Rollback switches the previous web release, preserving configuration and launcher
files; it is not an OS/package rollback. Keep a backup of `~/layr/bin`,
`~/layr/management`, `~/layr/layr.env` and the LAYR service units before upgrading
installer versions. Restore those files from your backup to reverse installer or
service changes. Package installation is not undone by uninstall.

`recover` disables only the LAYR kiosk, without requiring platform detection,
Moonraker, GitHub or healthy web assets. Use `sudo chvt 1` or Ctrl+Alt+F1 for a
console. `layr diagnose` reports architecture, OS, RAM, DRM connectors, heuristic
touchscreen discovery, inherited graphical session variables and service status.
Touch discovery is not a functional hardware test. Read logs with
`journalctl -u layr-web -u layr-kiosk -b --no-pager`.

Uninstall removes LAYR units and its matching global CLI link, keeps user data,
and restores KlipperScreen only when the existing LAYR marker records that LAYR
disabled it. Printer and unrelated desktop services remain untouched. Recovery
scripts also remain available directly in `~/layr/management`.

## Validation and release gate

```sh
npm run test:installer
npx vitest run tests/bootstrap.test.ts tests/deploy.test.ts
npm run verify
```

Python tests use temporary filesystem fixtures and mocked process boundaries.
They are architecture/profile contract tests, not native execution or actual APT,
systemd, browser or boot validation. Existing TypeScript deploy tests exercise the
shell scripts through isolated fake command environments. Do not merge or deploy
until both regression suites pass in a normal executor. Native fresh-image tests
and physical-device checks in the compatibility matrix are still release gates.

## Reviewed management behavior

`layr` opens a numbered terminal menu over SSH or a local text console; `0` exits.
`layr status` includes diagnostics. `layr start` starts the web service and resumes an already-enabled kiosk through
the guarded switcher; an active KlipperScreen blocks automatic display resumption. `layr stop` stops LAYR services without changing boot
persistence. `layr restart` restarts the web service and only an already active
kiosk. Use `layr switch layr` to activate the dedicated display, and `layr recover`
to disable kiosk boot startup. No lifecycle command restarts printer services.

`layr display` shows graphics/input inventory and offers cursor visibility.
`layr display --cursor hidden` saves only that setting. Touch inventory/event test
commands are printed for the operator. Arbitrary resolution, rotation and
calibration are not implemented; the preferred DRM display mode is retained.

`layr preflight --profile kiosk --moonraker http://printer:7125 --dist ./dist`
checks the target without installing packages or changing files/services. It also
simulates APT dependency resolution without permitting removals, requires systemd
and kiosk VT/DRM devices, and checks the Moonraker server/info API. A connectivity
failure stops installation/configuration unless `--allow-offline` is explicitly
provided. A reachable API does not establish browser CORS or WebSocket access.

A kiosk install leaves automatic startup disabled on an unverified device.
`--autostart` is held until a device-specific physical display test is recorded;
use `layr switch layr` for preview and `layr enable-kiosk` after visual validation. APT and installation failures stop further steps. There is no full
transaction rollback for OS packages or installer code. If kiosk activation fails,
use the printed recovery procedure; do not assume active systemd means rendered UI.

The installed global command binds to its management directory's installation
root and requires its owner for mutations. It does not follow a different caller's
HOME into another installation. A single system-wide owner is supported.


## Privilege preflight on minimal Debian

Sudo is an explicit prerequisite. The CLI validates presence, authentication and
execution as UID 0 before installation prompts and before privileged management
or recovery actions. Failures include the `su -`, APT and user-account setup
instructions in [the BT26 guide](mecer-bt26-test.md). Do not run the whole
installer as root. This keeps existing Raspberry Pi ownership behavior intact.

Interactive terminal/SSH sessions may authenticate through sudo. `--yes` and
non-terminal automation fail without prompting when cached/NOPASSWD authorization
is unavailable. Read-only status/diagnostics and user-owned configuration remain
usable without sudo. Shell-script dry runs remain read-only previews. The physical
test bundle already uploaded to GitHub is unchanged until an update is authorized.

## Current preview and management safety

The main menu stays open until `0. Exit`. Submenus offer `0. Back`. Results are
acknowledged before returning. Ctrl+C cancels a current action; EOF exits cleanly;
operations are never automatically replayed. SSH automation uses explicit commands
and remains one-shot. Plain `layr status` is a summary; `layr diagnose` or
`layr status --json` provides detailed JSON. `layr kiosk-diagnose` prints captured
journals, stderr, process/session state and dependency/DRM permission evidence.

Universal installation now stages web first and validates its local HTTP response
before preparing a disabled kiosk unit. `layr switch layr` starts a temporary
preview with boot startup disabled. `layr enable-kiosk` is the separate interactive
physical confirmation step; an active unit is insufficient and `--yes` cannot
substitute for seeing a rendered UI. The existing `--autostart` flag is retained
but held on unverified devices. Previous operator confirmation is historical and
device-specific, never an automatic current rendering/input check.

Display hardware presence, touchscreen discovery and successful touch interaction
are separate facts. Rotation/calibration remains unimplemented. No driver/GPU
workaround is inferred from an active unit or a flashing cursor. See
[BT26 evidence collection and upgrade instructions](bt26-blank-screen.md).


## Standalone local kiosk session

The kiosk unit uses a dedicated LAYR-managed PAM stack, required pam_systemd,
explicit seat0/tty7 metadata and the stock logind/Polkit activation policy. It does
not run Chromium as root, modify common PAM files, grant broad device permissions
or use seatd as a fallback. `polkitd` is an explicit Bookworm dependency. A Python
supervisor validates its own local session, activates it once and launches Cage as
an unprivileged child in the same controlling-terminal session. Renderer failures
retain stderr/nonzero status; shutdown has a five-second graceful period and a
10-second systemd bound. `Restart=no` preserves the first error for diagnosis.
Native PAM/logind/VT behavior still requires supervised target validation.


## Chromium backend selection

`LAYR_CHROMIUM_BACKEND=wayland|x11` controls Chromium's Ozone platform. Cage stays
Wayland in both cases. The unset/default value is Wayland, preserving existing
Raspberry Pi behavior. Fresh interactive i386/amd64 kiosk installation recommends
X11 for older Intel tablets and offers Wayland. Existing installations keep their
saved value when accepting the prompt; non-interactive installs keep the saved
value or default Wayland. Profile selection stays independent of architecture.
Pass `--chromium-backend x11|wayland` to preflight/install/update/repair to select
explicitly. That flag overrides an exported `LAYR_CHROMIUM_BACKEND`; otherwise the
saved env value is used. Kiosk X11 adds the `xwayland` package candidate/dependency
simulation before any install mutation. Both modes retain polkitd and the existing
kiosk graphical dependencies.

Use the persistent menu's Display and touchscreen submenu, or:

```bash
layr backend
layr backend --chromium-backend x11
layr backend --chromium-backend wayland
```

Selection preserves the Chromium profile, Moonraker, web release directories and
current process. It checks/installs XWayland for X11, disables boot startup for a
changed backend and invalidates previous display confirmation. It does not
restart the kiosk. Use `layr recover` followed by `layr switch layr` to test the
new service configuration; only then use `layr enable-kiosk`. That command checks
the service process's backend and records operator confirmation for the device,
backend and service. An earlier manual Cage launch cannot establish that record.
`layr status`/JSON shows configured and running-service backend evidence;
`layr kiosk-diagnose` adds XWayland packages/processes and preserves errors.

The launcher refuses invalid values or missing XWayland. Inside Cage it also
requires Cage's own XWayland DISPLAY, never an inherited unrelated X server. Cage
must have XWayland build support; failures are reported rather than falling back
to a touch-broken browser backend. Native Wayland uses the existing launch flags.
WPE/Cog is a separate optional engine and does not use this Chromium setting.
The confirmed BT26 manual X11 result and separate service test are documented in
[bt26-x11-upgrade.md](bt26-x11-upgrade.md).


## Optional Intel display power

The terminal Display and touchscreen menu now offers display-power status,
enable/disable, 1/5/10-minute or Never timeout, dim toggle/percentage and remote
wake. Defaults remain disabled on all platforms. Explicitly enabled Intel i915
kiosks default to four-minute 20% dim/five-minute backlight off and short power-key
wake, using actual input activity without suspending Linux. A root-owned,
sandboxed helper controls only the selected backlight and reads input; Chromium
stays unprivileged. A runtime logind inhibitor replaces permanent power-key policy
edits. See [display-power.md](display-power.md) for prerequisites, privileges,
restoration/crash behavior, unchanged Raspberry Pi defaults and exact BT26 tests.
This component is included in the BT26 Beta 2 packaging; the older
`0.2.0-20261104.1` combined download does not include it. See the
[Beta 2 guide](bt26-beta-2.md) and versioned release page for publication status.
