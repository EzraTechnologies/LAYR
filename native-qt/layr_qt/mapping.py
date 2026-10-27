"""Map Moonraker status objects into the values the dashboard shows."""

from __future__ import annotations

import math
from typing import Any

from .telemetry import config_number

JOB_STATES = {"standby", "printing", "paused", "complete", "cancelled", "error"}
KLIPPY_STATES = {"ready", "startup", "shutdown", "error", "disconnected"}
PROGRESS_ESTIMATE_MIN = 0.05
OPTIONAL_PREFIXES = ("temperature_sensor ", "temperature_fan ", "heater_generic ")
FAN_PREFIXES = ("fan_generic ", "heater_fan ", "controller_fan ")


def parse_klippy_state(value: Any) -> str:
    return value if isinstance(value, str) and value in KLIPPY_STATES else "unknown"


def parse_job_state(value: Any) -> str:
    return value if isinstance(value, str) and value in JOB_STATES else "unknown"


def _plain(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    return None


def merge_status(target: dict[str, Any], diff: Any) -> dict[str, Any]:
    """Merge a notify_status_update diff. Nested dicts merge one level deep."""
    body = _plain(diff)
    if body is None:
        return target
    for object_name, fields in body.items():
        nested = _plain(fields)
        if nested is None:
            continue
        current = target.get(object_name)
        if not isinstance(current, dict):
            current = {}
            target[object_name] = current
        for field, value in nested.items():
            existing = current.get(field)
            if isinstance(value, dict) and isinstance(existing, dict):
                current[field] = {**existing, **value}
            else:
                current[field] = value
    return target


def _clamp01(value: float | None) -> float | None:
    if value is None:
        return None
    return min(1.0, max(0.0, value))


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def estimate_remaining(
    progress: float | None, print_duration: float | None, slicer_estimate: float | None
) -> dict[str, Any]:
    elapsed = print_duration or 0
    has_progress = progress is not None and progress > 0 and elapsed > 0
    if has_progress and progress is not None and progress >= PROGRESS_ESTIMATE_MIN:
        return {"remaining": max(0.0, elapsed / progress - elapsed), "source": "progress"}
    if slicer_estimate is not None and slicer_estimate > 0:
        return {"remaining": max(0.0, slicer_estimate - elapsed), "source": "slicer"}
    if has_progress and progress is not None and progress >= 0.01:
        return {"remaining": max(0.0, elapsed / progress - elapsed), "source": "progress"}
    return {"remaining": None, "source": None}


def map_job(raw: dict[str, Any], slicer_estimate: float | None = None) -> dict[str, Any] | None:
    stats = _plain(raw.get("print_stats"))
    if stats is None:
        return None
    state = parse_job_state(stats.get("state"))
    filename = _text(stats.get("filename"))
    if not filename:
        return None
    display = _plain(raw.get("display_status")) or {}
    sdcard = _plain(raw.get("virtual_sdcard")) or {}
    progress = _clamp01(config_number(display.get("progress")))
    if progress is None:
        progress = _clamp01(config_number(sdcard.get("progress")))
    if state == "complete":
        progress = 1.0
    print_duration = config_number(stats.get("print_duration"))
    total_duration = config_number(stats.get("total_duration"))
    info = _plain(stats.get("info")) or {}
    remaining = None
    source = None
    if state in {"printing", "paused"}:
        estimate = estimate_remaining(progress, print_duration, slicer_estimate)
        remaining = estimate["remaining"]
        source = estimate["source"]
    return {
        "filename": filename,
        "state": state,
        "progress": progress,
        "printDuration": print_duration,
        "totalDuration": total_duration,
        "remaining": remaining,
        "remainingSource": source,
        "currentLayer": config_number(info.get("current_layer")),
        "totalLayers": config_number(info.get("total_layer")),
        "filamentUsed": config_number(stats.get("filament_used")),
        "message": _text(stats.get("message")) or _text(display.get("message")),
    }


def _object_suffix(name: str) -> str:
    return name.split(" ", 1)[1] if " " in name else name


def _is_chamber(name: str) -> bool:
    return " " in name and "chamber" in _object_suffix(name).lower()


def _label_for(name: str) -> str:
    if name == "extruder":
        return "Nozzle"
    if name == "heater_bed":
        return "Bed"
    if _is_chamber(name):
        return "Chamber"
    words = _object_suffix(name).replace("_", " ").replace("-", " ").strip()
    return words[:1].upper() + words[1:] if words else name


def _round1(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value * 10) / 10


def map_heater(raw: dict[str, Any], object_name: str) -> dict[str, Any] | None:
    obj = _plain(raw.get(object_name))
    if obj is None:
        return None
    sensor = object_name.startswith("temperature_sensor ")
    return {
        "object": object_name,
        "label": _label_for(object_name),
        "temperature": _round1(config_number(obj.get("temperature"))),
        "target": None if sensor else _round1(config_number(obj.get("target"))),
        "power": None if sensor else _clamp01(config_number(obj.get("power"))),
    }


def map_temperatures(raw: dict[str, Any]) -> dict[str, Any]:
    chamber = None
    sensors: list[dict[str, Any]] = []
    for name in sorted(raw):
        if not name.startswith(OPTIONAL_PREFIXES):
            continue
        reading = map_heater(raw, name)
        if reading is None:
            continue
        if chamber is None and _is_chamber(name):
            chamber = reading
        else:
            sensors.append(reading)
    return {
        "extruder": map_heater(raw, "extruder"),
        "bed": map_heater(raw, "heater_bed"),
        "chamber": chamber,
        "sensors": sensors,
    }


def _vector(value: Any, length: int) -> list[float] | None:
    if not isinstance(value, list) or len(value) < length:
        return None
    out: list[float] = []
    for item in value[:length]:
        number = config_number(item)
        if number is None:
            return None
        out.append(number)
    return out


def map_toolhead(raw: dict[str, Any]) -> dict[str, Any] | None:
    toolhead = _plain(raw.get("toolhead"))
    if toolhead is None:
        return None
    move = _plain(raw.get("gcode_move")) or {}
    origin = _vector(move.get("homing_origin"), 3)
    homed = toolhead.get("homed_axes")
    return {
        "homedAxes": homed.lower() if isinstance(homed, str) else "",
        "position": _vector(toolhead.get("position"), 4),
        "maxVelocity": config_number(toolhead.get("max_velocity")),
        "zOffset": None if origin is None else round(origin[2] * 1000) / 1000,
        "speedFactor": config_number(move.get("speed_factor")),
        "extrudeFactor": config_number(move.get("extrude_factor")),
    }


def _fan_label(name: str) -> str:
    if name == "fan":
        return "Part cooling"
    words = _object_suffix(name).replace("_", " ").replace("-", " ").strip()
    return words[:1].upper() + words[1:] if words else name


def map_fans(raw: dict[str, Any]) -> list[dict[str, Any]]:
    names = [name for name in raw if name == "fan" or name.startswith(FAN_PREFIXES)]

    def rank(name: str) -> tuple[int, str]:
        if name == "fan":
            return (0, name)
        if name.startswith("fan_generic "):
            return (1, name)
        return (2, name)

    fans: list[dict[str, Any]] = []
    for name in sorted(names, key=rank):
        obj = _plain(raw.get(name)) or {}
        speed = config_number(obj.get("speed"))
        if speed is not None:
            speed = min(1.0, max(0.0, speed))
        fans.append({"object": name, "label": _fan_label(name), "speed": speed, "rpm": config_number(obj.get("rpm"))})
    return fans


def derive_status(
    transport: str,
    klippy: str,
    job_state: str | None,
    klippy_message: str | None = None,
    job_message: str | None = None,
) -> dict[str, str | None]:
    if transport in {"idle", "waiting"}:
        return {"status": "disconnected", "detail": None}
    if transport == "connecting":
        return {"status": "connecting", "detail": "Connecting to Moonraker"}
    if klippy == "unknown":
        return {"status": "connecting", "detail": "Waiting for Klipper state"}
    if klippy == "startup":
        return {"status": "connecting", "detail": klippy_message or "Klipper is starting"}
    if klippy == "disconnected":
        return {"status": "disconnected", "detail": "Moonraker is online but Klipper is not connected"}
    if klippy in {"shutdown", "error"}:
        return {"status": "error", "detail": klippy_message or f"Klipper {klippy}"}
    if job_state == "printing":
        return {"status": "printing", "detail": None}
    if job_state == "paused":
        return {"status": "paused", "detail": job_message}
    if job_state == "error":
        return {"status": "error", "detail": job_message or "Print failed"}
    return {"status": "ready", "detail": None}


def config_settings_from(status: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(status, dict):
        return None
    configfile = status.get("configfile")
    if not isinstance(configfile, dict):
        return None
    settings = configfile.get("settings")
    if isinstance(settings, dict) and settings:
        return settings
    return None


def finite(value: Any) -> float | None:
    number = config_number(value)
    if number is None or not math.isfinite(number):
        return None
    return number
