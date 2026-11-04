# Installer compatibility matrix

This milestone adds installer support, not certified hardware compatibility.
No physical device was accessed by the implementation environment. Owner-supplied
BT26 observations are recorded separately from automated and native validation.

| Target | Detection/profile fixture tests | Native OS install/upgrade/recovery | Physical hardware |
| --- | --- | --- | --- |
| Debian 12 i386 | Automated | Untested | Untested |
| Debian 12 amd64 | Automated | Untested | Untested |
| Raspberry Pi OS Bookworm armhf | Architecture contract + existing Pi regression suite | Untested in this milestone | Untested in this milestone |
| Raspberry Pi OS/MainsailOS Bookworm arm64 | Architecture contract + existing Pi regression suite | Untested in this milestone | Untested in this milestone |
| Mecer/Mustek BT26, Atom Z3775D, 2 GB, Debian 12 i386 | Package-index availability + i386 contracts | Web/API work; systemd seat activation fix awaits physical retest | Owner-confirmed manual Cage + Chromium X11/XWayland rendering and ELAN touch; native Wayland touch failed; native file-picker touch fails; service/automatic startup unverified |
| Intel Linux tablet, existing desktop | Desktop conflict/profile contracts | Untested | Untested |
| Intel Linux tablet, KlipperScreen installed | Existing switcher regression tests | Untested | Untested |
| Intel Linux tablet, no KlipperScreen | Optional-component contracts | Untested | Untested |

All four package architectures use prebuilt web assets and system Python. Dedicated
kiosk support is conditional on compatible Bookworm Chromium, Cage, systemd/PAM,
libinput and working DRM/KMS. Chromium X11 additionally requires XWayland and a
Cage build with XWayland support. Missing package candidates are fatal before changes.
Other distributions/releases and armv6/armel are rejected. Touchscreen identification uses udev/kernel input interfaces; name-only fallbacks
are explicitly uncertain. Identification does not establish working input.

Before marking a device compatible, record model, CPU, architecture, OS image,
kernel, graphics driver, browser version, touchscreen controller and test date.
Validate fresh install, old-version upgrade, repeated installation, failed APT,
missing assets, web rollback, recovery and uninstall on an isolated image first.
Then validate real touchscreen calibration/multitouch, browser rendering and
WebSocket reconnection, GPU/DRM acceleration, Wi-Fi reconnect, suspend/resume,
rotation, SSH recovery and persistence over a cold boot. Repeat with and without
an existing KlipperScreen installation and ensure unrelated desktop sessions and
printer services remain usable. Keep results and logs with each hardware entry.

The pre-existing Pi manual procedure remains in [pi-test.md](pi-test.md); historical
notes there are not evidence that this milestone passed real-device validation.

For the first BT26 procedure see [mecer-bt26-test.md](mecer-bt26-test.md).
The official Bookworm main i386 Packages index was inspected on 2026-11-03: all
required packages have i386 or all entries. This proves repository availability,
not successful installation or working graphics on this tablet. Target preflight
still checks local APT candidates, simulates dependencies, and verifies VT/DRM.
Bookworm nodejs is 18.20.4 in that index, below the build requirement. Prebuilt
assets avoid requiring Node on any target; the universal CLI never selects an ARM
Node download on x86. Existing Pi bootstrap behavior remains a separate path.

The BT26 blank-screen symptom is not diagnosed from service activity alone. See
[bt26-blank-screen.md](bt26-blank-screen.md) for the precise read-only evidence
request, generic local safety fixes and upgrade steps without a Debian reinstall.


## BT26 manual touchscreen validation, received 2026-11-04

The owner confirmed visible LAYR and functional ELAN touch on the physical Mecer
B26T/BT26 with Debian 12 i386, Cage 0.1.4, Chromium 156 `--ozone-platform=x11`
and XWayland. `--ozone-platform=wayland` rendered LAYR but did not respond to touch.
This result validates only that manual configuration. The failed systemd
logind/VT startup path, automatic startup, full Wi-Fi/cold-boot persistence and
other models remain unverified. See [the X11 upgrade guide](bt26-x11-upgrade.md).
The ARM/i386/amd64 backend tests are isolated contracts, not additional physical
hardware passes. Wayland remains the existing Raspberry Pi default.

The cached official Bookworm i386 package index also contains `xwayland`
`2:22.1.9-1` with i386 architecture (checked 2026-11-04). This establishes archive
availability, not a fresh native dependency installation. Target preflight still
requires an actual compatible candidate and successful APT dependency simulation.


### Native file-picker exception

The BT26 manual X11 touch pass covers LAYR's web UI, not Chromium's native Linux
file picker: the owner reports touch cannot select or cancel inside that dialog.
The revised in-page illustration chooser avoids it and retains native upload as
an explicit option for compatible devices. This fallback is automated-tested but
awaits physical BT26 retesting. The exact GTK/portal/XWayland cause is unconfirmed;
see [touchscreen-file-picker.md](touchscreen-file-picker.md). No touchscreen,
graphics or service compatibility claim is expanded by this workaround.


### Optional display-power hardware API

The BT26 owner confirmed `intel_backlight` max 7812, bl_power 4/0, gpio-keys
KEY_POWER events (then event9), short-button wake and continued Linux/SSH operation
with HandlePowerKey=ignore. These are hardware API observations, not validation
of the new root controller. The opt-in service discovers names/nodes, gates on
Debian 12 Intel/i915/internal-panel/power-key capabilities and remains disabled by
default; ARM is rejected for enablement. Its native service sandbox, i386 input
ioctls, logind inhibition, hotplug/crash recovery and timing await supervised BT26
testing. See [display-power.md](display-power.md). No full tablet or automatic-start
compatibility is claimed by the new simulated tests.
