# Installer compatibility matrix

This milestone adds installer support, not certified hardware compatibility.
No new physical device was tested during this implementation.

| Target | Detection/profile fixture tests | Native OS install/upgrade/recovery | Physical hardware |
| --- | --- | --- | --- |
| Debian 12 i386 | Automated | Untested | Untested |
| Debian 12 amd64 | Automated | Untested | Untested |
| Raspberry Pi OS Bookworm armhf | Architecture contract + existing Pi regression suite | Untested in this milestone | Untested in this milestone |
| Raspberry Pi OS/MainsailOS Bookworm arm64 | Architecture contract + existing Pi regression suite | Untested in this milestone | Untested in this milestone |
| Mecer/Mustek BT26, Atom Z3775D, 2 GB, Debian 12 i386 | Package-index availability + i386 contracts only | Untested | Untested |
| Intel Linux tablet, existing desktop | Desktop conflict/profile contracts | Untested | Untested |
| Intel Linux tablet, KlipperScreen installed | Existing switcher regression tests | Untested | Untested |
| Intel Linux tablet, no KlipperScreen | Optional-component contracts | Untested | Untested |

All four package architectures use prebuilt web assets and system Python. Dedicated
kiosk support is conditional on compatible Bookworm Chromium, Cage, systemd/PAM,
libinput and working DRM/KMS. Missing package candidates are fatal before changes.
Other distributions/releases and armv6/armel are rejected. A touchscreen's presence
is reported heuristically and does not establish working input.

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
