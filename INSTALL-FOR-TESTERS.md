# Install LAYR — Tester Quick Start

**LAYR v1.0.0** is a free, open-source touchscreen interface for **Klipper + Moonraker**. You can install it alongside **KlipperScreen** and switch back if you prefer. This guide is for testers, so follow the steps in order.

> **Beta testing:** LAYR has been tested on a Raspberry Pi 4 with a 7-inch BTT HDMI touchscreen. Other combinations still need testing. Please only switch displays while your printer is **idle**, and keep SSH access available in case the touchscreen is blank.

## 1. Before you begin

You need:

- A Raspberry Pi already running **Klipper and Moonraker** (for example, MainsailOS).
- **Raspberry Pi OS Bookworm or MainsailOS Bookworm**, 32-bit armhf or 64-bit ARM.
- An HDMI touchscreen connected to the Pi. Typical resolutions are **1024×600** (7-inch) or **800×480** (5-inch); the installer does not force either resolution.
- Working Internet access on the Pi for the first installation.
- **SSH access** to the Pi (a terminal on your PC or Mac is fine). Log in as your normal printer user, often `pi`. **Do not log in as root or run the installer with `sudo`.**

**Important:** LAYR does not install Klipper, Moonraker or KlipperScreen. If you want to switch back to KlipperScreen, it must already be installed.

## 2. Connect to your Pi

Open your usual SSH program and connect to the same Raspberry Pi that runs your printer.

For example, from a terminal on your computer (replace the address/user with your own):

```bash
ssh pi@YOUR_PI_IP_ADDRESS
```

You should see a prompt similar to `pi@mainsailos:~ $`. Type the following commands **on the Pi**, not in the Mainsail/Fluidd G-code console.

## 3. Download and start the installer

Copy and paste these **two commands** into your SSH terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/EzraTechnologies/LAYR/main/deploy/layr-installer.sh -o /tmp/layr-installer.sh
bash /tmp/layr-installer.sh
```

**You do not need `chmod`** when starting the file with `bash`.

On the **first run**, the installer checks your Pi, OS, screen and Moonraker, then offers to install LAYR in **preview mode**. Read the messages, confirm the installation when asked, and allow it to finish.

- If an official release package is available, the installer downloads and verifies it.
- It **does not replace KlipperScreen during preview installation**.
- It does not reboot the Pi or change `printer.cfg`, `moonraker.conf` or `mmu.cfg`.

If the installer reports an unsupported OS or another error, **stop and send us the output** rather than trying to force it.

## 4. Show LAYR on your printer's touchscreen

**You do not need a keyboard, mouse, desktop or browser on the Raspberry Pi.** Keep using SSH from your normal computer.

Once installation finishes, run the installer again:

```bash
bash /tmp/layr-installer.sh
```

If LAYR is installed, the installer shows this menu:

```text
1) Switch to LAYR
2) Switch to KlipperScreen
3) Update
4) Repair
5) Diagnostics
6) Exit
```

Choose **1 — Switch to LAYR**.

LAYR automatically starts on your printer's connected HDMI touchscreen. **KlipperScreen stays installed** and can be switched back on whenever you want.

> **Test while your printer is idle.** Check that the touchscreen responds, buttons fit the screen and the status matches Mainsail or Fluidd. You do not need to jog axes, heat the hotend or load filament just to check the layout.

**Menu note:** The current installer exits to the SSH prompt after each choice. Run `bash /tmp/layr-installer.sh` again to make another selection. Uninstall is currently a separate command in Step 7.

## 5. Optional preview for advanced testers

A browser preview is **not required** for installation or testing.

LAYR's web service listens on the Pi's local loopback address (`127.0.0.1:7180`), so entering `http://127.0.0.1:7180` on your laptop will **not** open the Pi's LAYR page. Direct access via the Pi's IP address is not enabled by the standard installer.

If you're comfortable with SSH port forwarding, you can optionally open the Pi's LAYR page through a tunnel from your own computer. Otherwise, simply test it on the connected touchscreen as described in Step 4.

## 6. Switch back to KlipperScreen any time

From SSH, run the installer again and choose **2 — Switch to KlipperScreen**:

```bash
bash /tmp/layr-installer.sh
```

If the installer isn't available or there's no Internet, use the **offline recovery command** already installed on the Pi:

```bash
~/layr/src/deploy/layr-display.sh to-klipperscreen --yes
```

**Save that recovery command before testing.** It does not need GitHub or the LAYR web interface. If the display is blank, use SSH to run it; a text console is also available with Ctrl+Alt+F1 (or `sudo chvt 1`).

If the recovery script is missing, don't delete or disable any systemd services manually—report the issue.

## 7. Update, diagnostics, rollback or uninstall

Use the same installer menu for **Update (3)**, **Repair (4)** or **Diagnostics (5)**. An update keeps whichever display was already active; it does not switch automatically.

These commands are also available from SSH:

```bash
bash /tmp/layr-installer.sh --update
bash /tmp/layr-installer.sh diagnose
```

To return to the **previous installed LAYR build** (not KlipperScreen):

```bash
~/layr/src/deploy/rollback.sh --yes
```

To **uninstall LAYR**, run the separate removal script. It asks for confirmation and normally **keeps** the `~/layr` files:

```bash
~/layr/src/deploy/uninstall.sh
```

To remove LAYR's files as well, use `--purge` only after you're sure you no longer need them. The uninstall script does not remove Klipper or Moonraker.

## 8. Tell us how the test went

Please include the following with a GitHub issue:

- Printer and Raspberry Pi model (for example, Voron 2.4 + Pi 4).
- Operating system (MainsailOS / Pi OS, and version).
- Touchscreen make, size and resolution.
- Whether **installation, touch, LAYR ↔ KlipperScreen switching, thumbnails and normal printing** worked.
- Any warnings or errors (copy the SSH output or attach a screenshot).
- Whether you have **Spoolman**, **AFC / Box Turtle**, or **Happy Hare** installed.

**Report bugs:** [Open a LAYR GitHub Issue](https://github.com/EzraTechnologies/LAYR/issues)

Please **remove Wi-Fi passwords, API keys, access tokens or other private details** from logs/screenshots before posting them publicly.

## Optional tests — Spoolman, AFC and Happy Hare

These integrations are optional and are **not installed by LAYR**. If your printer already has one, enable it in LAYR's **Settings → Integrations** and follow the integration-specific checks:

- [Trident and integration test checklist](docs/trident-checklist.md)
- [Happy Hare test guidance](docs/happy-hare.md)

**Use only one filament controller per printer profile:** AFC and Happy Hare are mutually exclusive in LAYR Settings. Never test filament moves during an active print, and only confirm a move when you know it is safe.

---

**Need help?** Open a GitHub Issue with the exact step where you got stuck. You can always switch back to KlipperScreen using the offline command in **Step 6**, provided KlipperScreen was already installed.
