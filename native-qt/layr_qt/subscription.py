"""Klipper objects this prototype subscribes to.

Unknown objects are skipped, so a minimal config does not produce errors.
MMU and AFC objects are intentionally left out; see docs/integration.md.
"""

from __future__ import annotations

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

TELEMETRY_OBJECTS: dict[str, list[str]] = {
    "motion_report": ["live_velocity", "live_extruder_velocity"],
    "configfile": ["settings"],
}

OPTIONAL_OBJECTS: dict[str, list[str]] = {
    "fan": ["speed", "rpm"],
}

OPTIONAL_PREFIXES: dict[str, list[str]] = {
    "temperature_sensor ": ["temperature"],
    "temperature_fan ": ["temperature", "target", "speed"],
    "heater_generic ": ["temperature", "target", "power"],
}

FAN_PREFIXES = ("fan_generic ", "heater_fan ", "controller_fan ")
FAN_FIELDS = ["speed", "rpm"]
MAX_OPTIONAL_SENSORS = 8
MAX_FANS = 8


def _is_chamber(name: str) -> bool:
    suffix = name.split(" ", 1)[1] if " " in name else name
    return " " in name and "chamber" in suffix.lower()


def plan_subscription(available: list[str] | tuple[str, ...]) -> dict[str, object]:
    available_set = set(available)
    objects: dict[str, list[str]] = {}
    missing: list[str] = []

    for name, fields in CORE_OBJECTS.items():
        if name in available_set:
            objects[name] = list(fields)
        else:
            missing.append(name)
    for name, fields in OPTIONAL_OBJECTS.items():
        if name in available_set:
            objects[name] = list(fields)
    for name, fields in TELEMETRY_OBJECTS.items():
        if name in available_set:
            objects[name] = list(fields)

    optional: list[tuple[str, list[str]]] = []
    for name in available:
        prefix = next((item for item in OPTIONAL_PREFIXES if name.startswith(item)), None)
        if prefix:
            optional.append((name, list(OPTIONAL_PREFIXES[prefix])))
    optional.sort(key=lambda item: (not _is_chamber(item[0]), item[0]))
    for name, fields in optional[:MAX_OPTIONAL_SENSORS]:
        objects[name] = fields

    fans = [name for name in available if name != "fan" and (name.startswith(FAN_PREFIXES))]
    for name in fans[:MAX_FANS]:
        objects[name] = list(FAN_FIELDS)

    return {"objects": objects, "missing": missing}
