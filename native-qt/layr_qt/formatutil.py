"""Display formatting shared with the Svelte app's rules."""

from __future__ import annotations

import math


def format_duration(seconds: float | None) -> str:
    if seconds is None or not math.isfinite(seconds) or seconds < 0:
        return "—"
    whole = round(seconds)
    hours = whole // 3600
    minutes = (whole % 3600) // 60
    secs = whole % 60
    if hours > 0:
        return f"{hours}h {minutes:02d}m"
    if minutes >= 10:
        return f"{minutes}m"
    if minutes > 0:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def format_temp(value: float | None) -> str:
    if value is None or not math.isfinite(value):
        return "—"
    return str(round(value))


def format_percent(progress: float | None) -> str:
    if progress is None or not math.isfinite(progress):
        return "—"
    clamped = min(1.0, max(0.0, progress))
    return str(math.floor(clamped * 100))


def display_filename(path: str) -> str:
    name = path.split("/")[-1] if path else path
    for ext in (".gcode", ".gco", ".ufp", ".g"):
        if name.lower().endswith(ext):
            return name[: -len(ext)]
    return name


def format_speed(mm_per_s: float | None) -> str:
    if mm_per_s is None or not math.isfinite(mm_per_s):
        return "—"
    return str(round(mm_per_s))


def format_flow(mm3_per_s: float | None) -> str:
    if mm3_per_s is None or not math.isfinite(mm3_per_s):
        return "—"
    quantized = round(mm3_per_s * 10) / 10
    if quantized == 0:
        quantized = 0.0
    return f"{quantized:.1f}"


def format_bytes(size: float | None) -> str:
    if size is None or not math.isfinite(size) or size < 0:
        return "—"
    if size < 1024:
        return f"{int(size)} B"
    units = ["KB", "MB", "GB"]
    value = size / 1024
    unit = 0
    while value >= 1024 and unit < len(units) - 1:
        value /= 1024
        unit += 1
    text = str(round(value)) if value >= 100 else f"{value:.1f}"
    return f"{text} {units[unit]}"
