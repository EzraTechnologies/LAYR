"""Device-local preferences. Nothing here is written to the printer or the OS hostname."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .urls import is_valid_moonraker_url

DEFAULT_URL = "http://localhost:7125"
THEMES = {"midnight", "black"}


def config_dir() -> Path:
    override = os.environ.get("LAYR_QT_CONFIG_DIR")
    if override:
        return Path(override)
    base = os.environ.get("XDG_CONFIG_HOME")
    root = Path(base) if base else Path.home() / ".config"
    return root / "layr-qt"


def state_dir() -> Path:
    override = os.environ.get("LAYR_QT_STATE_DIR")
    if override:
        return Path(override)
    base = os.environ.get("XDG_STATE_HOME")
    root = Path(base) if base else Path.home() / ".local" / "state"
    return root / "layr-qt"


@dataclass
class Preferences:
    moonraker_url: str = DEFAULT_URL
    display_name: str = ""
    hide_cursor: bool = True
    theme: str = "midnight"
    width: int = 1024
    height: int = 600

    @property
    def configured(self) -> bool:
        return bool(self.moonraker_url.strip())


def clean_display_name(value: str) -> str:
    cleaned = "".join(ch for ch in value if ord(ch) >= 32).strip()
    return cleaned[:32]


def parse_preferences(raw: str | None) -> Preferences:
    prefs = Preferences()
    if not raw:
        return prefs
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return prefs
    if not isinstance(value, dict):
        return prefs
    url = value.get("moonrakerUrl", prefs.moonraker_url)
    if isinstance(url, str):
        trimmed = url.strip()
        if trimmed == "" or is_valid_moonraker_url(trimmed):
            prefs.moonraker_url = trimmed
    if isinstance(value.get("displayName"), str):
        prefs.display_name = clean_display_name(value["displayName"])
    if isinstance(value.get("hideCursor"), bool):
        prefs.hide_cursor = value["hideCursor"]
    if value.get("theme") in THEMES:
        prefs.theme = value["theme"]
    if isinstance(value.get("width"), int) and value["width"] >= 640:
        prefs.width = value["width"]
    if isinstance(value.get("height"), int) and value["height"] >= 400:
        prefs.height = value["height"]
    return prefs


def load_preferences(path: Path | None = None) -> Preferences:
    file = path or (config_dir() / "preferences.json")
    try:
        return parse_preferences(file.read_text(encoding="utf-8"))
    except OSError:
        return Preferences()


def save_preferences(prefs: Preferences, path: Path | None = None) -> None:
    file = path or (config_dir() / "preferences.json")
    file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "moonrakerUrl": prefs.moonraker_url,
        "displayName": prefs.display_name,
        "hideCursor": prefs.hide_cursor,
        "theme": prefs.theme,
        "width": prefs.width,
        "height": prefs.height,
    }
    temporary = file.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(file)
