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

A kiosk install asks whether to enable automatic startup. Automation opts in with
`--autostart`; this uses the existing guarded display switch after the web install
succeeds. APT and installation failures stop further steps. There is no full
transaction rollback for OS packages or installer code. If kiosk activation fails,
use the printed recovery procedure; do not assume active systemd means rendered UI.

The installed global command binds to its management directory's installation
root and requires its owner for mutations. It does not follow a different caller's
HOME into another installation. A single system-wide owner is supported.
