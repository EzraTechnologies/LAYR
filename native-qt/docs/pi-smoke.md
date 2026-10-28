# Pi smoke checklist

Run this on the Raspberry Pi 4 with the BTT HDMI7 after you choose to try the Qt controller. The agent that prepared the branch did not have that hardware. A green `verify.sh` on a PC does not count as this checklist.

Do this while the printer is idle, with the bed clear, until the motion checks are done. Keep the Chromium kiosk installed so rollback is one command.

## Before switching the panel

1. From the LAYR checkout, as the printer user:

   ```bash
   ./native-qt/scripts/check-deps.sh
   cd native-qt && ./scripts/verify.sh
   ```

2. Windowed session, without taking tty7:

   ```bash
   ./native-qt/scripts/launch-session.sh --geometry 1024x600
   ```

   Confirm Home matches Moonraker: temperatures, progress, thumbnail, layers, mm/s, and mm³/s. Pull the network for a moment and confirm the live numbers clear and then return. A success message must not appear before the printer answers.

3. Install the unit and leave it disabled:

   ```bash
   ./native-qt/scripts/kiosk-install.sh --dry-run --yes
   ./native-qt/scripts/kiosk-install.sh --yes
   systemctl is-enabled layr-qt.service
   ```

   Expect `disabled`. Confirm `~/layr-native-qt/backup/` contains a copy of the manual `layr-qt-test.service` if that file existed. The original unit file should still be in place.

4. `./native-qt/scripts/kiosk-switch.sh status` and note which of `layr-kiosk` and `KlipperScreen` is the one you will return to.

## Service and touch

5. `./native-qt/scripts/kiosk-switch.sh to-qt --yes`
6. Confirm only `layr-qt.service` is active. `layr-kiosk`, `KlipperScreen`, and `layr-qt-test` should be inactive.
7. The picture should be on tty7 at the panel's native mode. Taps should land on the control under the finger. Compare that feel with the Chromium kiosk you already know. Write down anything that lags.
8. Ctrl+Alt+F1 should still reach another VT. The unit uses Cage `-s` so VT switching stays available.

## Pointer

9. With Hide pointer on (the default), look for a mouse arrow while you only use touch. The launcher sets `XCURSOR_THEME=layr-blank` and `WLR_NO_HARDWARE_CURSORS=1`. Qt's own blank cursor was not enough on Cage before this change.
10. Plug in a mouse. It should still click. The sprite should be blank while Hide pointer is on.
11. Setup → show the pointer, save, restart `layr-qt.service` only. The normal arrow should come back. Touch must still work. Set Hide pointer on again afterwards if you want the blank sprite.
12. Record the result in the PR or the issue. Until you do, the pointer change is unverified.

## Keyboard

13. On the 1024×600 panel, open Setup and focus Printer name, then Moonraker URL. The keyboard should be fully on screen and the field should sit above it. Repeat on Heat → Set, and on More → the console line.
14. If you have an 800×480 mode, repeat those three fields. `b7b438f` fixed the keyboard height in the read-only shell. This branch adds the scroll. Neither has been confirmed on the HDMI7 by the agent.

## Controls, idle

15. Home the printer from Move. Jog X, Y, and Z by a small step. Confirm the machine moved the amount you asked, and that a second tap while the first is in flight does nothing extra.
16. Try to jog before homing, and try to jog Z below 0. Nothing should move.
17. Heat the nozzle to a normal preset. Try a target above the Klipper max and confirm it is refused. Turn the heater off.
18. With the hotend cold, Extrude must refuse. Above `min_extrude_temp`, a short extrude should run once. Load and Unload should appear only if those macros exist.
19. Set the part fan to 50% and back to off. A heater fan or controller fan, if listed, should say Automatic and should not change when tapped.
20. More: run one known macro that has no parameters, and confirm it. Open the console, type one line, and confirm it. Cancel the dialog and confirm nothing was sent.

## Moonraker auth

21. On a trusted-client LAN, leave `LAYR_QT_API_KEY` unset and confirm the socket connects.
22. If Moonraker rejects the client, put the key only in the service environment or the shell, not in `preferences.json`. A 401 or 403 should mention trusted clients. The key must not show up in the UI or in a screenshot.

## Live print

23. Start a small known-good file from Files and confirm the dialog before it starts. Home should show progress, the thumbnail, layers, mm/s, and mm³/s.
24. Pause, resume, and then cancel with the confirmation. While printing, Move should offer Z babystep and should not offer jogging. Heat changes should ask first.
25. Hold STOP only if you intend to emergency-stop. A short tap must not fire it. After an emergency stop, restart Klipper from More only when you mean to.

## Rollback

26. `./native-qt/scripts/kiosk-switch.sh rollback --yes` should disable `layr-qt` and enable the single panel recorded in step 4.
27. If you need a specific panel instead: `to-chromium --yes` or `to-klipperscreen --yes`. Afterwards exactly one of those three display units should be active.
28. Confirm the printer is still the same Klipper session: this switch must not have restarted Klipper or Moonraker, and `printer.cfg` / `moonraker.conf` must be unchanged.

## If it will not start

- `journalctl -u layr-qt.service -b --no-pager`
- `./native-qt/scripts/qt-kiosk.sh --print-env` prints the cursor theme and `touch=enabled`. It does not start Cage.
- The unit refuses to start while another display is active. Switch with `kiosk-switch.sh` rather than starting a second compositor.
- `layr-qt` must be installed before `to-qt`. `kiosk-install.sh` does not enable it.
- Do not set `LAYR_QT_ALLOW_EGLFS=1` to get a picture. EGLFS can take the HDMI device from the running session.
