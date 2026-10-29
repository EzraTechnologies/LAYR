# Raspberry Pi reboot and shutdown

Manual check for the Settings controls that call Moonraker `machine.reboot` and `machine.shutdown`.
Nothing in CI presses these buttons. Do not run this list from an agent, a deploy script, or an
unattended session. Do not start it unless a person is at the printer and intends to reboot or
shut down that Raspberry Pi.

LAYR does not edit `moonraker.conf`, `printer.cfg`, or sudoers for this. It does not run a shell
command. The only requests are the two JSON-RPC methods above, with no parameters, on the Moonraker
this screen is already connected to.

## Before either button

- [ ] The printer is idle. No print is running or paused. The bed is clear if a reboot would interrupt heat or motion.
- [ ] Settings shows a **Raspberry Pi** section and a separate **Klipper** section. Restart Klipper and Firmware restart are the Klipper actions. They are not the Pi buttons.
- [ ] The Raspberry Pi section names the connected host (the Klipper hostname, often `mainsailos` or the name you already use). It is the Pi this LAYR screen is talking to, not another computer.
- [ ] Cancel **Reboot this Raspberry Pi?** with Go back or Escape. Moonraker must not log `machine.reboot`.
- [ ] Cancel **Shut down this Raspberry Pi?** the same way. Moonraker must not log `machine.shutdown`.
- [ ] Start a print, or pause one, and confirm both Pi buttons are disabled and say why. Cancel the print from the dashboard if you started it only for this check. Do not shut the Pi down during that print.
- [ ] If Moonraker is offline, Klipper is not ready, or the host has not reported the `machine` component, both buttons stay off.

## Only if you mean to reboot

- [ ] Confirm **Reboot Raspberry Pi**. The dialog says it is the Raspberry Pi host, not a Klipper firmware restart, and that LAYR will lose its connection.
- [ ] The screen may go offline before Moonraker answers. That is not proof the Pi finished rebooting. Wait until the Pi is back, then reload LAYR and confirm the printer is idle and Klipper is ready.
- [ ] The printer power supply is unchanged by this button. Heaters and motors come back only after Klipper is ready again.

## Only if you mean to shut down

- [ ] Read the dialog. It says a software shutdown does not necessarily remove power, and that starting again may need a physical power cycle or an external power controller.
- [ ] Confirm **Shut down Raspberry Pi** only if that is what you want. LAYR will go offline. Do not treat a dropped connection as proof that power is gone.
- [ ] If the Pi is still powered, switch it off or power-cycle it the way you usually do. LAYR will not do that for you.
- [ ] Power the Pi back on yourself when you want it. Confirm Klipper and Moonraker are up before printing.

## If Moonraker refuses

- [ ] A denied or missing host command shows an error and does not say the Pi restarted. The buttons stay off after a refusal until the connection changes.
- [ ] Fix permission in Moonraker's own configuration or host policy if you want the action. Do not add a sudoers rule or a shell endpoint for LAYR as part of this check.
