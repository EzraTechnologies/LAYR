"""Control snapshot built from a Moonraker store.

Live fields are cleared unless Moonraker is connected and Klipper is ready, so a
dropped socket cannot be jogged from stale positions or temperatures.
"""

from __future__ import annotations

import re
from typing import Any

from layr_qt.moonraker.status import derive_status, map_job, map_temperatures, parse_job_state
from layr_qt.moonraker.telemetry import config_number, js_round

AXES = ("x", "y", "z")

FALLBACK_LIMITS: dict[str, Any] = {
    "fromConfig": False,
    "extruder": {
        "minTemp": 0,
        "maxTemp": 280,
        "minExtrudeTemp": 170,
        "maxExtrudeOnlyDistance": 50,
        "maxExtrudeOnlyVelocity": None,
    },
    "bed": {"minTemp": 0, "maxTemp": 110},
    "heaters": {},
    "maxVelocity": None,
    "maxZVelocity": None,
}

LED_PREFIXES = ("led ", "neopixel ", "dotstar ", "pca9533 ", "pca9632 ")
LIGHT_PIN_RE = re.compile(r"(light|led|lamp|lighting|lights)", re.IGNORECASE)
FAN_CONTROLLABLE = {"fan_generic ": True, "heater_fan ": False, "controller_fan ": False}
LOAD_MACROS = ("LOAD_FILAMENT", "FILAMENT_LOAD", "LOAD", "M701")
UNLOAD_MACROS = ("UNLOAD_FILAMENT", "FILAMENT_UNLOAD", "UNLOAD", "M702")
PARAM_RES = (
    re.compile(r"params\.([A-Za-z_][A-Za-z0-9_]*)"),
    re.compile(r"params\[\s*['\"]([^'\"]+)['\"]\s*\]"),
)
DEFAULT_FILTER_RE = re.compile(r"^\s*\|\s*default\b")
DEFINED_RE = re.compile(r"^\s+is\s+defined")
IN_PARAMS_RE = re.compile(r"['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\s+in\s+params\b")


def object_suffix(name: str) -> str:
    space = name.find(" ")
    return name if space < 0 else name[space + 1 :]


def humanize(name: str) -> str:
    words = re.sub(r"[_-]+", " ", name).strip()
    if not words:
        return name
    return words[0].upper() + words[1:]


def is_homed(state: dict, axis: str) -> bool:
    toolhead = state.get("toolhead") or {}
    return axis in (toolhead.get("homedAxes") or "")


def _vector(value: object, length: int) -> list[float] | None:
    if not isinstance(value, list) or len(value) < length:
        return None
    numbers = [config_number(item) for item in value[:length]]
    if any(item is None for item in numbers):
        return None
    return [float(item) for item in numbers if item is not None]


def _copy_limits(limits: dict) -> dict:
    return {
        "fromConfig": limits["fromConfig"],
        "extruder": dict(limits["extruder"]),
        "bed": None if limits["bed"] is None else dict(limits["bed"]),
        "heaters": {key: dict(value) for key, value in limits["heaters"].items()},
        "maxVelocity": limits["maxVelocity"],
        "maxZVelocity": limits["maxZVelocity"],
    }


def _heater_limits(section: dict | None, fallback: dict | None) -> dict | None:
    if not isinstance(section, dict):
        return None if fallback is None else dict(fallback)
    maximum = config_number(section.get("max_temp"))
    if maximum is None:
        return None if fallback is None else dict(fallback)
    minimum = config_number(section.get("min_temp"))
    return {"minTemp": 0 if minimum is None else minimum, "maxTemp": maximum}


def map_limits(settings: dict | None) -> dict:
    """Limits from ``configfile.settings``. Missing extruder max falls back to conservative defaults."""
    settings = settings or {}
    extruder = settings.get("extruder") if isinstance(settings.get("extruder"), dict) else None
    if extruder is None or config_number(extruder.get("max_temp")) is None:
        return _copy_limits(FALLBACK_LIMITS)
    heaters: dict[str, dict] = {}
    for section, values in settings.items():
        if not section.startswith("heater_generic ") or not isinstance(values, dict):
            continue
        limits = _heater_limits(values, None)
        if limits:
            heaters[section] = limits
    printer = settings.get("printer") if isinstance(settings.get("printer"), dict) else {}
    bed_section = settings.get("heater_bed") if isinstance(settings.get("heater_bed"), dict) else None
    base = _heater_limits(extruder, FALLBACK_LIMITS["extruder"]) or dict(FALLBACK_LIMITS["extruder"])
    distance = config_number(extruder.get("max_extrude_only_distance"))
    return {
        "fromConfig": True,
        "extruder": {
            "minTemp": base["minTemp"],
            "maxTemp": base["maxTemp"],
            "minExtrudeTemp": config_number(extruder.get("min_extrude_temp"))
            if config_number(extruder.get("min_extrude_temp")) is not None
            else FALLBACK_LIMITS["extruder"]["minExtrudeTemp"],
            "maxExtrudeOnlyDistance": FALLBACK_LIMITS["extruder"]["maxExtrudeOnlyDistance"] if distance is None else distance,
            "maxExtrudeOnlyVelocity": config_number(extruder.get("max_extrude_only_velocity")),
        },
        "bed": _heater_limits(bed_section, None),
        "heaters": heaters,
        "maxVelocity": config_number(printer.get("max_velocity")) if isinstance(printer, dict) else None,
        "maxZVelocity": config_number(printer.get("max_z_velocity")) if isinstance(printer, dict) else None,
    }


def map_toolhead(raw: dict) -> dict | None:
    toolhead = raw.get("toolhead")
    if not isinstance(toolhead, dict):
        return None
    move = raw.get("gcode_move") if isinstance(raw.get("gcode_move"), dict) else {}
    origin = _vector(move.get("homing_origin"), 3)
    z_offset = None if origin is None else js_round(origin[2] * 1000) / 1000
    homed = toolhead.get("homed_axes")
    return {
        "homedAxes": homed.lower() if isinstance(homed, str) else "",
        "position": _vector(toolhead.get("position"), 4),
        "axisMin": _vector(toolhead.get("axis_minimum"), 3),
        "axisMax": _vector(toolhead.get("axis_maximum"), 3),
        "maxVelocity": config_number(toolhead.get("max_velocity")),
        "zOffset": z_offset,
        "speedFactor": config_number(move.get("speed_factor")),
        "extrudeFactor": config_number(move.get("extrude_factor")),
    }


def _fan_controllable(name: str) -> bool:
    if name == "fan":
        return True
    for prefix, controllable in FAN_CONTROLLABLE.items():
        if name.startswith(prefix):
            return controllable
    return False


def map_control_fans(raw: dict) -> list[dict]:
    names = [name for name in raw if name == "fan" or name.startswith(tuple(FAN_CONTROLLABLE))]

    def rank(name: str) -> tuple[int, str]:
        if name == "fan":
            return (0, name)
        if name.startswith("fan_generic "):
            return (1, name)
        return (2, name)

    fans = []
    for name in sorted(names, key=rank):
        obj = raw.get(name)
        if not isinstance(obj, dict):
            continue
        speed = config_number(obj.get("speed"))
        if speed is not None:
            speed = min(1.0, max(0.0, speed))
        label = "Part cooling" if name == "fan" else humanize(object_suffix(name))
        fans.append(
            {
                "object": name,
                "label": label,
                "speed": speed,
                "rpm": config_number(obj.get("rpm")),
                "controllable": _fan_controllable(name),
            }
        )
    return fans


def is_light_object(name: str) -> bool:
    if name.startswith(LED_PREFIXES):
        return True
    if name.startswith("output_pin "):
        return LIGHT_PIN_RE.search(object_suffix(name)) is not None
    return False


def _truthy(value: object) -> bool:
    return value is True or value in ("True", "true", 1)


def map_lights(raw: dict, settings: dict | None) -> list[dict]:
    settings = settings or {}
    lights = []
    for name in sorted(name for name in raw if is_light_object(name)):
        status = raw.get(name)
        if not isinstance(status, dict):
            continue
        section = settings.get(name.lower()) if isinstance(settings.get(name.lower()), dict) else {}
        if name.startswith("output_pin "):
            value = config_number(status.get("value"))
            scale = config_number(section.get("scale")) if isinstance(section, dict) else None
            lights.append(
                {
                    "object": name,
                    "label": humanize(object_suffix(name)),
                    "kind": "pin",
                    "value": None if value is None else min(1.0, max(0.0, value)),
                    "dimmable": _truthy(section.get("pwm")) if isinstance(section, dict) else False,
                    "scale": 1 if scale is None or scale <= 0 else scale,
                }
            )
            continue
        colors = status.get("color_data") if isinstance(status.get("color_data"), list) else []
        first = colors[0] if colors and isinstance(colors[0], list) else []
        channels = [item for item in (config_number(part) for part in first) if item is not None]
        lights.append(
            {
                "object": name,
                "label": humanize(object_suffix(name)),
                "kind": "led",
                "value": None if not channels else max(channels),
                "dimmable": True,
                "scale": 1,
            }
        )
    return lights


def scan_macro_params(template: object) -> dict:
    if not isinstance(template, str):
        return {"params": [], "required": []}
    optional: set[str] = set()
    found: set[str] = set()
    for pattern in PARAM_RES:
        for match in pattern.finditer(template):
            name = match.group(1).upper()
            found.add(name)
            after = template[match.end() :]
            if DEFAULT_FILTER_RE.match(after) or DEFINED_RE.match(after):
                optional.add(name)
    for match in IN_PARAMS_RE.finditer(template):
        optional.add(match.group(1).upper())
    params = sorted(found)
    return {"params": params, "required": [name for name in params if name not in optional]}


def map_macros(objects: list[str] | None, settings: dict | None) -> list[dict]:
    settings = settings or {}
    macros = []
    for obj in objects or []:
        if not isinstance(obj, str) or not obj.startswith("gcode_macro "):
            continue
        name = object_suffix(obj).upper()
        section = settings.get(obj.lower()) if isinstance(settings.get(obj.lower()), dict) else {}
        description = section.get("description") if isinstance(section, dict) else ""
        description = description.strip() if isinstance(description, str) else ""
        if description == "G-Code macro":
            description = ""
        scan = scan_macro_params(section.get("gcode") if isinstance(section, dict) else None)
        macros.append(
            {
                "name": name,
                "description": description or None,
                "params": scan["params"],
                "requiredParams": scan["required"],
                "hidden": name.startswith("_"),
            }
        )
    macros.sort(key=lambda item: item["name"])
    return macros


def find_macro(macros: list[dict], candidates: tuple[str, ...]) -> str:
    names = {item["name"] for item in macros}
    for candidate in candidates:
        if candidate in names:
            return candidate
    return ""


def heater_readings(state: dict) -> list[dict]:
    readings = [state.get("extruder"), state.get("bed"), state.get("chamber"), *(state.get("sensors") or [])]
    return [
        item
        for item in readings
        if isinstance(item, dict) and item.get("target") is not None and not str(item.get("object") or "").startswith("temperature_fan ")
    ]


def _empty_state(status: str, transport: str, klippy: str) -> dict:
    return {
        "status": status,
        "transport": transport,
        "klippy": klippy,
        "job": None,
        "toolhead": None,
        "limits": _copy_limits(FALLBACK_LIMITS),
        "extruder": None,
        "bed": None,
        "chamber": None,
        "sensors": [],
        "canExtrude": None,
        "fans": [],
        "lights": [],
        "macros": [],
    }


def build_snapshot(store: Any, *, configured: bool) -> dict:
    """State ``prepare_command`` reads. Not live → no positions, heaters, fans, or macros."""
    transport = getattr(store, "transport", "idle") or "idle"
    klippy = getattr(store, "klippy", "unknown") or "unknown"
    if not configured:
        state = _empty_state("unconfigured", transport, klippy)
        state["status"] = "unconfigured"
        return state
    live = transport == "connected" and klippy == "ready"
    if not live:
        raw = {}
        job_state = None
        derived = derive_status(transport, klippy, job_state, getattr(store, "klippy_message", None), None)
        state = _empty_state(derived["status"], transport, klippy)
        return state
    raw = store.raw if isinstance(store.raw, dict) else {}
    settings = store.settings if isinstance(store.settings, dict) else {}
    temps = map_temperatures(raw)
    job = map_job(raw, getattr(store, "slicer_estimate", None))
    stats = raw.get("print_stats") if isinstance(raw.get("print_stats"), dict) else None
    job_state = parse_job_state(stats.get("state")) if stats else None
    derived = derive_status(transport, klippy, job_state, getattr(store, "klippy_message", None), job.get("message") if job else None)
    extruder = temps.get("extruder")
    can = None
    extruder_raw = raw.get("extruder") if isinstance(raw.get("extruder"), dict) else {}
    if isinstance(extruder_raw.get("can_extrude"), bool):
        can = extruder_raw["can_extrude"]
    return {
        "status": derived["status"],
        "transport": transport,
        "klippy": klippy,
        "job": None
        if job is None
        else {"state": job.get("state"), "filename": job.get("filename") or ""},
        "toolhead": map_toolhead(raw),
        "limits": map_limits(settings),
        "extruder": extruder,
        "bed": temps.get("bed"),
        "chamber": temps.get("chamber"),
        "sensors": list(temps.get("sensors") or []),
        "canExtrude": can,
        "fans": map_control_fans(raw),
        "lights": map_lights(raw, settings),
        "macros": map_macros(list(getattr(store, "objects", []) or []), settings),
    }
