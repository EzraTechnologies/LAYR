"""Opt-in Qt kiosk scripts. They must not enable a service during install."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(script: str, home: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged["HOME"] = str(home)
    merged.pop("XDG_CONFIG_HOME", None)
    if env:
        merged.update(env)
    return subprocess.run(
        ["bash", str(ROOT / "scripts" / script), *args],
        cwd=ROOT,
        env=merged,
        text=True,
        capture_output=True,
        check=False,
    )


def test_kiosk_install_is_opt_in_and_backs_up_the_manual_unit(tmp_path: Path):
    text = (ROOT / "scripts" / "kiosk-install.sh").read_text(encoding="utf-8")
    for forbidden in ("systemctl enable", "systemctl start", "systemctl stop", "systemctl disable", "systemctl restart"):
        assert forbidden not in text
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        assert "printer.cfg" not in line
        assert "moonraker.conf" not in line

    refused = run("kiosk-install.sh", tmp_path)
    assert refused.returncode == 2
    assert not (tmp_path / "layr-native-qt").exists()

    etc = tmp_path / "etc" / "systemd" / "system"
    etc.mkdir(parents=True)
    manual = etc / "layr-qt-test.service"
    manual.write_text("[Service]\nExecStart=/bin/true\n", encoding="utf-8")
    user_unit = tmp_path / ".config" / "systemd" / "user" / "layr-qt-test.service"
    user_unit.parent.mkdir(parents=True)
    user_unit.write_text("manual-user-unit\n", encoding="utf-8")
    unit_dir = tmp_path / "units"
    dry = run(
        "kiosk-install.sh",
        tmp_path,
        "--dry-run",
        "--yes",
        env={"LAYR_QT_ETC": str(tmp_path / "etc"), "LAYR_QT_SYSTEMD_DIR": str(unit_dir)},
    )
    assert dry.returncode == 0, dry.stderr
    assert "not enabled" in dry.stdout
    assert not unit_dir.exists()
    assert not list((tmp_path / "layr-native-qt").glob("backup/*"))

    installed = run(
        "kiosk-install.sh",
        tmp_path,
        "--yes",
        env={"LAYR_QT_ETC": str(tmp_path / "etc"), "LAYR_QT_SYSTEMD_DIR": str(unit_dir)},
    )
    assert installed.returncode == 0, installed.stderr
    unit = (unit_dir / "layr-qt.service").read_text(encoding="utf-8")
    assert "User=" in unit
    assert "qt-kiosk.sh" in unit
    assert "KlipperScreen.service" in unit
    assert "layr-kiosk.service" in unit
    backups = sorted((tmp_path / "layr-native-qt" / "backup").glob("*layr-qt-test.service.*"))
    assert len(backups) == 2
    assert any("ExecStart=/bin/true" in path.read_text(encoding="utf-8") for path in backups)
    assert any(path.read_text(encoding="utf-8") == "manual-user-unit\n" for path in backups)
    assert manual.read_text(encoding="utf-8").startswith("[Service]")
    assert "not enabled" in installed.stdout


def test_switch_never_enables_two_panels(tmp_path: Path):
    qt = run("kiosk-switch.sh", tmp_path, "to-qt", "--dry-run")
    assert qt.returncode == 0, qt.stderr
    lines = [line for line in qt.stdout.splitlines() if line.startswith("systemctl ")]
    text = "\n".join(lines)
    assert text.index("disable --now KlipperScreen.service") < text.index("enable --now layr-qt.service")
    assert text.index("disable --now layr-kiosk.service") < text.index("enable --now layr-qt.service")
    assert text.index("disable --now layr-qt-test.service") < text.index("enable --now layr-qt.service")
    assert "enable --now layr-kiosk.service" not in text
    assert "enable --now KlipperScreen.service" not in text

    chromium = run("kiosk-switch.sh", tmp_path, "to-chromium", "--dry-run")
    assert chromium.returncode == 0, chromium.stderr
    body = "\n".join(line for line in chromium.stdout.splitlines() if line.startswith("systemctl "))
    assert "disable --now layr-qt.service" in body
    assert "disable --now KlipperScreen.service" in body
    assert "enable --now layr-kiosk.service" in body
    assert "enable --now layr-qt.service" not in body
    assert "enable --now KlipperScreen.service" not in body

    screen = run("kiosk-switch.sh", tmp_path, "to-klipperscreen", "--dry-run")
    screen_body = "\n".join(line for line in screen.stdout.splitlines() if line.startswith("systemctl "))
    assert "disable --now layr-qt.service" in screen_body
    assert "disable --now layr-kiosk.service" in screen_body
    assert "enable --now KlipperScreen.service" in screen_body
    assert "enable --now layr-qt.service" not in screen_body
    assert "enable --now layr-kiosk.service" not in screen_body

    refused = run("kiosk-switch.sh", tmp_path, "to-qt")
    assert refused.returncode == 2
    assert not (tmp_path / "layr-native-qt" / "state").exists()


def test_cursor_theme_is_compositor_level_and_touch_stays_on(tmp_path: Path):
    icons = tmp_path / "icons"
    hidden = run(
        "qt-kiosk.sh",
        tmp_path,
        "--print-env",
        env={"LAYR_QT_ICON_ROOT": str(icons)},
    )
    assert hidden.returncode == 0, hidden.stderr
    assert "XCURSOR_THEME=layr-blank" in hidden.stdout
    assert "WLR_NO_HARDWARE_CURSORS=1" in hidden.stdout
    assert "touch=enabled" in hidden.stdout
    assert "mouse=optional" in hidden.stdout
    assert "disable-touch" not in hidden.stdout
    cursor = icons / "layr-blank" / "cursors" / "left_ptr"
    assert cursor.is_file()
    assert cursor.stat().st_size > 0

    config = tmp_path / ".config" / "layr-native-qt" / "preferences.json"
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({"hideCursor": False, "moonrakerUrl": "http://localhost:7125"}), encoding="utf-8")
    shown = run(
        "qt-kiosk.sh",
        tmp_path,
        "--print-env",
        env={"LAYR_QT_CONFIG": str(config), "LAYR_QT_ICON_ROOT": str(tmp_path / "icons-off")},
    )
    assert shown.returncode == 0, shown.stderr
    assert "XCURSOR_THEME=system" in shown.stdout
    assert "XCURSOR_THEME=layr-blank" not in shown.stdout
    assert not (tmp_path / "icons-off").exists()
