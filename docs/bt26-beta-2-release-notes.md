# LAYR 0.2.0 — Intel BT26 Beta 2

**Beta / Testing pre-release. Not a stable release.** One shared LAYR application
supports platform-specific installation; this is not a separate tablet fork.

- Universal terminal installer and global `layr` management CLI for supported
  Bookworm ARM, i386 and amd64 targets; no target Node.js/frontend compilation.
- Configurable Chromium X11 through XWayland for older Intel tablets, preserving
  Raspberry Pi's existing native Wayland default. The BT26 owner validated manual
  Cage + Chromium X11 rendering and ELAN touch; native Wayland touch failed.
- Persistent CLI navigation, display/backend settings, readable diagnostics,
  web-first setup, dependency/privilege checks and bounded SSH recovery.
- Touch-friendly in-page printer-image chooser with three bundled illustrations.
  Existing native upload, image restrictions, saved photos and profiles remain.
- Optional Intel/i915 display-power controller: four-minute 20% dim, five-minute
  backlight off, physical short power-button wake, SSH wake and crash restoration.
  Disabled by default. It never suspends Linux, changes networking or runs the
  browser as root. Power handling uses a temporary logind inhibitor.

**Service-based kiosk operation and the new display-power service still require
physical BT26 validation.** Active systemd services are not proof of visible
graphics, functional touch, wake, crash recovery, Wi-Fi or cold-boot persistence.
The BT26 kernel backlight/button API was owner-tested separately. Native file
picker touch remains unreliable under the tested XWayland setup; use bundled
illustrations or a keyboard/mouse. Arbitrary rotation/calibration is unimplemented.
ARM regressions establish software compatibility, not new hardware certification.

Raspberry Pi defaults are preserved. Intel power management cannot activate on
ARM. No live Pi/tablet deployment or merge into main is part of publication.
KlipperScreen stays optional and is never installed automatically; no printer
configuration is changed. Required target packages come from the tablet's
Bookworm APT repositories after compatible-candidate/dependency simulation;
the archive does not contain offline Debian packages or foreign Node binaries.

Download both `layr-bt26-test-0.2.0-20261104.2.tar.gz` and its `.sha256` asset.
The repository is private: use authenticated GitHub downloads. Verify the external
checksum, extract into a new directory, verify `SHA256SUMS` and matching
`deploy/bt26-build.json` / `dist/bt26-build.json` before installing.

The complete copy-and-paste guide, including a closed-browser/full-install backup,
in-place upgrade that retains saved Moonraker/port/profile and releases, physical
tests, rollback and SSH recovery, is
[INSTALL-BT26.md in the archive](https://github.com/EzraTechnologies/LAYR/blob/v0.2.0-20261104.2-bt26/docs/bt26-beta-2.md).
Kiosk autostart stays disabled initially. Display power remains disabled until
explicitly enabled after a working service-based kiosk preview.

After upgrading, inspect `layr status`, `layr kiosk-diagnose` and
`layr display-power status`. Start only a supervised preview with
`layr switch layr`. Recovery is `layr display-power wake`,
`layr display-power disable --yes` and `layr recover`. Web-only rollback is
`layr rollback --yes`; disable/remove the optional controller before rolling back
management code. These operations target the tablet, not remote Moonraker.

Publication is gated on complete installer/application/browser/authenticated
browser/Pi regressions, Svelte/build checks, shell validation, rendered-unit
verification and a clean-extracted package inventory/checksum/provenance check.
The release's Actions run records the exact commit and validation results.
`BUILD.json` identifies that same commit in both installer and prebuilt frontend.
