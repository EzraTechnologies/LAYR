"""Panel preferences. The printer name here never changes the Linux hostname."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from layr_qt.moonraker.urls import DEFAULT_MOONRAKER_URL, validate_moonraker_url

DIM_OPTIONS = (0, 1, 5, 10, 30)
THEMES = ("midnight", "black")


def default_preferences_path() -> Path:
    root = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(root) / "layr-native-qt" / "preferences.json"


def default_preferences() -> dict:
    return {
        "moonrakerUrl": DEFAULT_MOONRAKER_URL,
        "displayName": "",
        "theme": "midnight",
        "hideCursor": True,
        "dimAfterMinutes": 0,
    }


def sanitize_display_name(value: object) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = "".join(ch for ch in value if ord(ch) >= 32).strip()
    return cleaned[:32]


def parse_preferences(raw: object) -> dict:
    prefs = default_preferences()
    if not isinstance(raw, dict):
        return prefs
    url = validate_moonraker_url(raw["moonrakerUrl"]) if isinstance(raw.get("moonrakerUrl"), str) else None
    if url:
        prefs["moonrakerUrl"] = url
    prefs["displayName"] = sanitize_display_name(raw.get("displayName"))
    if raw.get("theme") in THEMES:
        prefs["theme"] = raw["theme"]
    if isinstance(raw.get("hideCursor"), bool):
        prefs["hideCursor"] = raw["hideCursor"]
    if raw.get("dimAfterMinutes") in DIM_OPTIONS:
        prefs["dimAfterMinutes"] = raw["dimAfterMinutes"]
    return prefs


def load_preferences(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return default_preferences()
    except OSError:
        return default_preferences()
    try:
        return parse_preferences(json.loads(text))
    except json.JSONDecodeError:
        return default_preferences()


def save_preferences(path: Path, prefs: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(parse_preferences(prefs), indent=2) + "\n"
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False)
    try:
        handle.write(payload)
        handle.close()
        os.replace(handle.name, path)
    finally:
        if os.path.exists(handle.name):
            os.unlink(handle.name)


def resolve_printer_name(display_name: str, hostname: str | None) -> tuple[str, str]:
    """Return ``(name, source)``. Source is override, hostname, or fallback.

    The machine's OS hostname is never consulted.
    """
    override = sanitize_display_name(display_name)
    if override:
        return override, "override"
    if isinstance(hostname, str) and hostname.strip():
        return hostname.strip(), "hostname"
    return "Klipper printer", "fallback"
