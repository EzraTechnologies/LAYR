# Touchscreen printer-image selection on XWayland

## Reported physical limitation

On the Mecer BT26, Debian 12 i386, Cage + Chromium X11/XWayland renders LAYR and
accepts ELAN touch input. The owner reports that Chromium's native Linux file
picker opens when choosing a custom printer image, but its navigation, selection
and Cancel controls do not respond to touch. This is an exception to the manual
web-interface touch pass, not evidence that the touchscreen is absent.

## Investigation and limits of the finding

The old `PrinterImageChooser.svelte` called `.click()` on a hidden HTML
`input[type=file]` directly from Choose photo. The file's `change` event, image
validation, compression and storage occur only after the browser returns a file.
LAYR does not render that operating-system dialog or handle its input. A working
web page followed by an unresponsive native dialog is consistent with a native
Chromium/toolkit/XWayland input integration failure, rather than evidence of a
failure in the image-compression or IndexedDB path.

Chromium has separate Linux native picker implementations, including
[GTK](https://github.com/chromium/chromium/blob/main/ui/gtk/select_file_dialog_linux_gtk.cc)
and [the desktop portal](https://github.com/chromium/chromium/blob/main/ui/shell_dialogs/select_file_dialog_linux_portal.cc).
These current upstream sources establish possible architectures, not which
implementation/version the tablet's packaged Chromium actually uses. The active
toolkit/portal and precise cause are **not confirmed**, and the evidence does not
establish that the failure is exclusive to XWayland. Chromium's Ozone flag does
not prove which display backend a GTK/portal dialog uses; a portal can run in a
separate process. Headless automation cannot
validate physical touch inside the native dialog. Native Wayland is not proposed
as a workaround: touch in the main LAYR page already failed in that tested mode.
No toolkit packages, portals, input rules, graphics permissions, Chromium security
flags or kiosk session configuration were changed for this fix. Qt is not required
or tested. The separate systemd seat/VT startup problem remains separate.

## Recommended implementation

Choose photo now opens a normal in-page chooser. It offers original bundled
Enclosed, Open frame and Compact printer illustrations. Tap an illustration and
then Use illustration to save it. Merely selecting a tile changes no saved data.
Cancel is at the top of the chooser; Escape also closes it and returns focus to
Choose photo. Navigation remains available. This is not a native dialog.

The artwork is embedded PNG data, so selection needs neither a network request
nor local file access. It becomes a File and goes through the existing validation,
JPEG compression and per-printer/Moonraker IndexedDB save path. Existing uploaded
photos and their browser-profile storage are not migrated or removed.

Compatible devices retain native photo upload under Upload a local photo → Open
system file picker. That section warns about touch failures and recommends a
keyboard/mouse before opening the system dialog. Neither Choose photo, selecting
an illustration, expanding the upload explanation nor cancellation opens a file
picker. Only that explicit native-upload button does. Cancelling the native input
leaves the in-page Cancel option available after control returns to Chromium.

The following restrictions are unchanged:

- Input formats: JPEG, PNG, WebP and GIF; imported SVG and other formats refused.
- Maximum original: 8 MiB; GIF uses its first frame.
- Stored copy: JPEG, longest edge at most 1024 px and at most 400 KiB.
- Browser-local IndexedDB, scoped to printer identity and Moonraker address;
  at most eight printers, with existing eviction behavior.
- No photo is uploaded to Moonraker or written into printer configuration.
- Storage failure keeps the previously saved photo and reports an error.

There is no arbitrary image-URL import in this change. Bundled illustrations
provide the requested offline fallback while keeping the existing raster-file
and storage restrictions intact. A URL import would need its own bounded fetch,
timeout/cancellation, scheme/CORS validation and decode policy; an unvalidated
remote `<img>` would bypass the existing restrictions.

## Physical test and recovery

On a reviewed updated web build, with the existing X11 backend/profile retained:

1. Open Settings → Printer image → Choose photo using only touch. Confirm no
   system window opens and Cancel is reachable.
2. Select each illustration, cancel before saving, and confirm the old photo
   remains. Then select one and tap Use illustration.
3. Check Home, reload/restart Chromium, and confirm the selected image persists
   for this printer. Check removal and that another Moonraker address does not
   inherit it. Do not use motion/heater controls for this test.
4. Expand Upload a local photo. Confirm this alone opens no system dialog. Try
   native upload only with a keyboard/mouse available; do not count native-dialog
   touch as fixed by the fallback.

If an old native dialog is already stuck, use a physical keyboard's Esc or an
attached mouse to cancel it. An in-page button cannot dismiss a native dialog
that is intercepting input. Do not clear the Chromium profile or delete its image
database. For a service-managed kiosk, the existing SSH `layr recover` stops only
LAYR's kiosk; after investigating, `layr switch layr` requests a temporary service
preview. A manual Cage session is separate: close it from its original console
instead of terminating all Chromium processes or all user sessions. Web rollback
restores assets only and is not a browser-profile reset.

The new in-page fallback still needs a physical BT26 retest. The earlier manual
Cage/X11 pass does not validate the revised app flow or automatic startup. No new
build has been uploaded or deployed; older test downloads do not include this fix.

## Read-only diagnostics for the native-dialog cause

As the same user that launches Cage, capture:

```bash
chromium --version
dpkg-query -W chromium xwayland libgtk-3-0 libgtk-4-1 xdg-desktop-portal xdg-desktop-portal-gtk
systemctl --user status xdg-desktop-portal.service xdg-desktop-portal-gtk.service --no-pager
journalctl --user -b -u xdg-desktop-portal.service -u xdg-desktop-portal-gtk.service -n 100 --no-pager
ps -eo pid,ppid,comm | grep -E 'chromium|Xwayland|xdg-desktop'
```

Absent packages/services may return nonzero status; that is diagnostic evidence,
not an instruction to install them. Record whether an attached mouse and keyboard
work in the same dialog. An SSH shell's DISPLAY does not identify the dialog's
actual display backend. Do not guess a toolkit fix from missing portal packages.

## Automated coverage

Unit coverage validates the bundled PNG catalog against the existing size/format
policy and refuses arbitrary URLs/paths as illustration IDs. Touch browser tests
at 1024×600 and 800×480 cover all three choices offline, zero native filechooser
events, cancellation without storage changes, Escape/focus return, touch target
layout, persistence, and storage failures. Explicit native upload and empty
selection are exercised through Playwright's filechooser interception; this
preserves the browser input flow but does **not** exercise physical GTK/portal
interaction. Existing bad-format, oversized-file, scope, quota, thumbnail and
photo-removal regressions remain applicable. Final results are recorded in
[installer-validation.md](installer-validation.md).
