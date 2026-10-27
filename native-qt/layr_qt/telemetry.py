"""Live speed and volumetric flow from Klipper motion_report.

Speed factor and extrude factor are override multipliers. They are not the
mm/s and mm³/s values shown on the dashboard.
"""

from __future__ import annotations

import math
from typing import Any

DIAMETER_MIN_MM = 0.5
DIAMETER_MAX_MM = 5.0


def config_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    try:
        parsed = float(trimmed)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def filament_cross_section_area_mm2(diameter_mm: float) -> float:
    radius = diameter_mm / 2
    return math.pi * radius * radius


def volumetric_flow_mm3_per_s(extruder_velocity_mm_s: float, diameter_mm: float) -> float:
    """Negative feed rate (retraction) produces a negative flow."""
    return extruder_velocity_mm_s * filament_cross_section_area_mm2(diameter_mm)


def quantize_speed_mm_s(mm_per_s: float) -> int:
    return round(mm_per_s)


def quantize_flow_mm3_s(mm3_per_s: float) -> float:
    quantized = round(mm3_per_s * 10) / 10
    return 0.0 if quantized == 0 else quantized


def filament_diameter_mm(settings: dict[str, Any], active_extruder: Any) -> float | None:
    if isinstance(active_extruder, str) and active_extruder.strip():
        name = active_extruder.strip().lower()
    else:
        name = "extruder"
    section = settings.get(name)
    if not isinstance(section, dict):
        return None
    diameter = config_number(section.get("filament_diameter"))
    if diameter is None or diameter < DIAMETER_MIN_MM or diameter > DIAMETER_MAX_MM:
        return None
    return diameter


def map_motion(raw: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    report = raw.get("motion_report")
    report = report if isinstance(report, dict) else None
    speed_raw = config_number(report.get("live_velocity")) if report else None
    extrude_raw = config_number(report.get("live_extruder_velocity")) if report else None
    speed = None if speed_raw is None else quantize_speed_mm_s(max(0.0, speed_raw))
    toolhead = raw.get("toolhead") if isinstance(raw.get("toolhead"), dict) else {}
    diameter = filament_diameter_mm(settings, toolhead.get("extruder"))

    if extrude_raw is None:
        return {"speedMmS": speed, "flowMm3S": None, "filamentDiameterMm": diameter, "flowGap": "velocity"}
    if diameter is None:
        return {"speedMmS": speed, "flowMm3S": None, "filamentDiameterMm": None, "flowGap": "diameter"}
    return {
        "speedMmS": speed,
        "flowMm3S": quantize_flow_mm3_s(volumetric_flow_mm3_per_s(extrude_raw, diameter)),
        "filamentDiameterMm": diameter,
        "flowGap": None,
    }
