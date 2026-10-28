"""JSON-RPC helpers and the Moonraker method allow-lists.

Reads are the default. Printer-changing methods are accepted only when the
command gateway sets ``control=True``. Spoolman writes, MMU commands, machine
power, and config writes stay rejected. See ``adapters.py``.
"""

from __future__ import annotations

import json
import re
from typing import Any

READ_METHODS = frozenset(
    {
        "server.connection.identify",
        "server.info",
        "printer.info",
        "printer.objects.list",
        "printer.objects.query",
        "printer.objects.subscribe",
        "server.files.get_directory",
        "server.files.metadata",
        "server.files.thumbnails",
        "server.gcode_store",
    }
)

# Only the command gateway may encode these. The session's status RPCs pass control=False.
CONTROL_METHODS = frozenset(
    {
        "printer.gcode.script",
        "printer.print.start",
        "printer.print.pause",
        "printer.print.resume",
        "printer.print.cancel",
        "printer.emergency_stop",
        "printer.restart",
        "printer.firmware_restart",
        "server.files.delete_file",
    }
)

LED_PREFIXES = ("led ", "neopixel ", "dotstar ", "pca9533 ", "pca9632 ")
LIGHT_PIN_RE = re.compile(r"(light|led|lamp|lighting|lights)", re.IGNORECASE)
MAX_LIGHTS = 6

CORE_OBJECTS: dict[str, list[str]] = {
    "webhooks": ["state", "state_message"],
    "print_stats": ["filename", "state", "message", "print_duration", "total_duration", "filament_used", "info"],
    "display_status": ["progress", "message"],
    "virtual_sdcard": ["progress", "is_active", "file_path"],
    "extruder": ["temperature", "target", "power", "can_extrude"],
    "heater_bed": ["temperature", "target", "power"],
    "toolhead": ["homed_axes", "position", "axis_minimum", "axis_maximum", "max_velocity", "extruder"],
    "gcode_move": ["homing_origin", "speed_factor", "extrude_factor"],
    "idle_timeout": ["state"],
}

OPTIONAL_OBJECTS: dict[str, list[str]] = {"fan": ["speed", "rpm"]}

TELEMETRY_OBJECTS: dict[str, list[str]] = {
    "motion_report": ["live_velocity", "live_extruder_velocity"],
    "configfile": ["settings"],
}

OPTIONAL_PREFIXES: dict[str, list[str]] = {
    "temperature_sensor ": ["temperature"],
    "temperature_fan ": ["temperature", "target", "speed"],
    "heater_generic ": ["temperature", "target", "power"],
}

FAN_PREFIXES = ("fan_generic ", "heater_fan ", "controller_fan ")
MAX_OPTIONAL_SENSORS = 8
MAX_FANS = 8


class MethodNotAllowedError(RuntimeError):
    def __init__(self, method: str) -> None:
        super().__init__(f'Moonraker method "{method}" is not permitted by the Qt prototype')
        self.method = method


def is_allowed_method(method: str, *, control: bool = False) -> bool:
    if control:
        return method in CONTROL_METHODS
    return method in READ_METHODS


def is_light_object(name: str) -> bool:
    if name.startswith(LED_PREFIXES):
        return True
    if name.startswith("output_pin "):
        suffix = name.split(" ", 1)[1]
        return LIGHT_PIN_RE.search(suffix) is not None
    return False


def is_fan_object(name: str) -> bool:
    return name == "fan" or name.startswith(FAN_PREFIXES)


def is_chamber_object(name: str) -> bool:
    if " " not in name:
        return False
    return "chamber" in name.split(" ", 1)[1].lower()


def plan_subscription(available: list[str]) -> dict[str, Any]:
    """Subscribe only to objects this printer actually exposes.

    MMU / AFC objects are deliberately left out. A later adapter can discover
    them with ``adapters.mmu_object_names`` without changing this plan.
    """
    present = set(available)
    objects: dict[str, list[str]] = {}
    missing: list[str] = []
    for name, fields in CORE_OBJECTS.items():
        if name in present:
            objects[name] = list(fields)
        else:
            missing.append(name)
    for name, fields in OPTIONAL_OBJECTS.items():
        if name in present:
            objects[name] = list(fields)
    for name, fields in TELEMETRY_OBJECTS.items():
        if name in present:
            objects[name] = list(fields)

    optional: list[tuple[str, list[str]]] = []
    for name in available:
        for prefix, fields in OPTIONAL_PREFIXES.items():
            if name.startswith(prefix):
                optional.append((name, fields))
                break
    optional.sort(key=lambda item: (0 if is_chamber_object(item[0]) else 1, item[0]))
    for name, fields in optional[:MAX_OPTIONAL_SENSORS]:
        objects[name] = list(fields)

    fans = [name for name in available if name != "fan" and is_fan_object(name)]
    for name in fans[:MAX_FANS]:
        objects[name] = ["speed", "rpm"]
    lights = [name for name in available if is_light_object(name)]
    for name in lights[:MAX_LIGHTS]:
        objects[name] = ["value"] if name.startswith("output_pin ") else ["color_data"]
    return {"objects": objects, "missing": missing}


def encode_request(rpc_id: int, method: str, params: dict | None = None, *, control: bool = False) -> str:
    if not is_allowed_method(method, control=control):
        raise MethodNotAllowedError(method)
    body: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "id": rpc_id}
    if params is not None:
        body["params"] = params
    return json.dumps(body, separators=(",", ":"))


def decode_message(text: str) -> dict | None:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(value, dict):
        return None
    return value


def is_plain_object(value: object) -> bool:
    return isinstance(value, dict)


def merge_status(target: dict, diff: object) -> dict:
    """Merge a ``notify_status_update`` diff. Nested dicts merge one level."""
    if not isinstance(diff, dict):
        return target
    for object_name, fields in diff.items():
        if not isinstance(fields, dict):
            continue
        current = target.get(object_name)
        if not isinstance(current, dict):
            current = {}
            target[object_name] = current
        for field, value in fields.items():
            existing = current.get(field)
            if isinstance(value, dict) and isinstance(existing, dict):
                current[field] = {**existing, **value}
            else:
                current[field] = value
    return target


def config_settings_from(status: dict | None) -> dict | None:
    if not isinstance(status, dict):
        return None
    configfile = status.get("configfile")
    if not isinstance(configfile, dict):
        return None
    settings = configfile.get("settings")
    if not isinstance(settings, dict) or not settings:
        return None
    return settings


def status_diff_from_params(params: object) -> dict | None:
    if isinstance(params, list) and params and isinstance(params[0], dict):
        return params[0]
    if isinstance(params, dict):
        status = params.get("status")
        return status if isinstance(status, dict) else params
    return None
