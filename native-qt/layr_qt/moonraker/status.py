"""Map Moonraker status into the fields the dashboard shows."""

from __future__ import annotations

from datetime import datetime, timezone

from layr_qt.moonraker.protocol import is_chamber_object
from layr_qt.moonraker.telemetry import config_number, js_round

JOB_STATES = ("standby", "printing", "paused", "complete", "cancelled", "error")
KLIPPY_STATES = ("ready", "startup", "shutdown", "error", "disconnected")
PROGRESS_ESTIMATE_MIN = 0.05

STATUS_META = {
    "disconnected": {"label": "Offline", "tone": "dim"},
    "connecting": {"label": "Connecting", "tone": "purple"},
    "ready": {"label": "Ready", "tone": "ok"},
    "printing": {"label": "Printing", "tone": "cyan"},
    "paused": {"label": "Paused", "tone": "warn"},
    "error": {"label": "Error", "tone": "danger"},
}


def parse_klippy_state(value: object) -> str:
    return value if isinstance(value, str) and value in KLIPPY_STATES else "unknown"


def parse_job_state(value: object) -> str:
    return value if isinstance(value, str) and value in JOB_STATES else "unknown"


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _clamp01(value: float | None) -> float | None:
    if value is None:
        return None
    return min(1.0, max(0.0, value))


def estimate_remaining(progress: float | None, print_duration: float | None, slicer_estimate: float | None) -> dict:
    elapsed = print_duration or 0
    has_progress = progress is not None and progress > 0 and elapsed > 0
    if has_progress and progress >= PROGRESS_ESTIMATE_MIN:
        return {"remaining": max(0.0, elapsed / progress - elapsed), "source": "progress"}
    if slicer_estimate is not None and slicer_estimate > 0:
        return {"remaining": max(0.0, slicer_estimate - elapsed), "source": "slicer"}
    if has_progress and progress >= 0.01:
        return {"remaining": max(0.0, elapsed / progress - elapsed), "source": "progress"}
    return {"remaining": None, "source": None}


def map_job(raw: dict, slicer_estimate: float | None = None) -> dict | None:
    stats = raw.get("print_stats")
    if not isinstance(stats, dict):
        return None
    state = parse_job_state(stats.get("state"))
    filename = _text(stats.get("filename"))
    if filename is None:
        return None
    display = raw.get("display_status") if isinstance(raw.get("display_status"), dict) else {}
    sdcard = raw.get("virtual_sdcard") if isinstance(raw.get("virtual_sdcard"), dict) else {}
    progress = _clamp01(config_number(display.get("progress")) if display.get("progress") is not None else config_number(sdcard.get("progress")))
    if display.get("progress") is None and sdcard.get("progress") is not None:
        progress = _clamp01(config_number(sdcard.get("progress")))
    elif display.get("progress") is not None:
        progress = _clamp01(config_number(display.get("progress")))
    if state == "complete":
        progress = 1.0
    info = stats.get("info") if isinstance(stats.get("info"), dict) else {}
    remaining = None
    source = None
    if state in ("printing", "paused"):
        estimate = estimate_remaining(progress, config_number(stats.get("print_duration")), slicer_estimate)
        remaining = estimate["remaining"]
        source = estimate["source"]
    return {
        "filename": filename,
        "state": state,
        "progress": progress,
        "printDuration": config_number(stats.get("print_duration")),
        "totalDuration": config_number(stats.get("total_duration")),
        "remaining": remaining,
        "remainingSource": source,
        "currentLayer": config_number(info.get("current_layer")),
        "totalLayers": config_number(info.get("total_layer")),
        "filamentUsed": config_number(stats.get("filament_used")),
        "message": _text(stats.get("message")) or _text(display.get("message")),
    }


def derive_status(transport: str, klippy: str, job_state: str | None, klippy_message: str | None, job_message: str | None) -> dict:
    if transport in ("idle", "waiting"):
        return {"status": "disconnected", "detail": None}
    if transport == "connecting":
        return {"status": "connecting", "detail": "Connecting to Moonraker"}
    if klippy == "unknown":
        return {"status": "connecting", "detail": "Waiting for Klipper state"}
    if klippy == "startup":
        return {"status": "connecting", "detail": klippy_message or "Klipper is starting"}
    if klippy == "disconnected":
        return {"status": "disconnected", "detail": "Moonraker is online but Klipper is not connected"}
    if klippy in ("shutdown", "error"):
        return {"status": "error", "detail": klippy_message or f"Klipper {klippy}"}
    if job_state == "printing":
        return {"status": "printing", "detail": None}
    if job_state == "paused":
        return {"status": "paused", "detail": job_message}
    if job_state == "error":
        return {"status": "error", "detail": job_message or "Print failed"}
    return {"status": "ready", "detail": None}


def headline(status: str, job: dict | None) -> str:
    if status == "printing" and job is not None and (job.get("printDuration") or 0) == 0:
        return "Preparing"
    if status == "ready" and job is not None and job.get("state") == "complete":
        return "Print complete"
    if status == "ready" and job is not None and job.get("state") == "cancelled":
        return "Print cancelled"
    return STATUS_META.get(status, STATUS_META["disconnected"])["label"]


def _round1(value: float | None) -> float | None:
    if value is None:
        return None
    return js_round(value * 10) / 10


def _label_for(object_name: str) -> str:
    if object_name == "extruder":
        return "Nozzle"
    if object_name == "heater_bed":
        return "Bed"
    if is_chamber_object(object_name):
        return "Chamber"
    words = object_name.split(" ", 1)[-1].replace("_", " ").replace("-", " ").strip()
    return words[:1].upper() + words[1:] if words else object_name


def map_heater(raw: dict, object_name: str) -> dict | None:
    obj = raw.get(object_name)
    if not isinstance(obj, dict):
        return None
    sensor = object_name.startswith("temperature_sensor ")
    return {
        "object": object_name,
        "label": _label_for(object_name),
        "temperature": _round1(config_number(obj.get("temperature"))),
        "target": None if sensor else _round1(config_number(obj.get("target"))),
        "power": None if sensor else _clamp01(config_number(obj.get("power"))),
    }


def map_temperatures(raw: dict) -> dict:
    chamber = None
    sensors: list[dict] = []
    prefix = ("temperature_sensor ", "temperature_fan ", "heater_generic ")
    for name in sorted(raw):
        if not name.startswith(prefix):
            continue
        reading = map_heater(raw, name)
        if reading is None:
            continue
        if chamber is None and is_chamber_object(name):
            chamber = reading
        else:
            sensors.append(reading)
    return {
        "extruder": map_heater(raw, "extruder"),
        "bed": map_heater(raw, "heater_bed"),
        "chamber": chamber,
        "sensors": sensors,
    }


def map_fans(raw: dict) -> list[dict]:
    names = [name for name in raw if name == "fan" or name.startswith(("fan_generic ", "heater_fan ", "controller_fan "))]

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
        speed = _clamp01(config_number(obj.get("speed")))
        label = "Part cooling" if name == "fan" else _label_for(name)
        fans.append({"object": name, "label": label, "speed": speed})
    return fans


def _vector(value: object, length: int) -> list[float] | None:
    if not isinstance(value, list) or len(value) < length:
        return None
    numbers = [config_number(item) for item in value[:length]]
    if any(item is None for item in numbers):
        return None
    return [float(item) for item in numbers if item is not None]


def map_toolhead(raw: dict) -> dict | None:
    toolhead = raw.get("toolhead")
    if not isinstance(toolhead, dict):
        return None
    move = raw.get("gcode_move") if isinstance(raw.get("gcode_move"), dict) else {}
    return {
        "homedAxes": toolhead.get("homed_axes").lower() if isinstance(toolhead.get("homed_axes"), str) else "",
        "position": _vector(toolhead.get("position"), 4),
        "maxVelocity": config_number(toolhead.get("max_velocity")),
        "speedFactor": config_number(move.get("speed_factor")),
        "extrudeFactor": config_number(move.get("extrude_factor")),
    }


def format_duration(seconds: float | None) -> str:
    if seconds is None or seconds < 0:
        return "—"
    whole = js_round(seconds)
    hours, rem = divmod(whole, 3600)
    minutes, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours}h {minutes:02d}m"
    if minutes >= 10:
        return f"{minutes}m"
    if minutes > 0:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def format_clock(epoch_ms: float | None, *, utc: bool = False) -> str:
    if epoch_ms is None:
        return "—"
    if utc:
        moment = datetime.fromtimestamp(epoch_ms / 1000, timezone.utc)
    else:
        moment = datetime.fromtimestamp(epoch_ms / 1000).astimezone()
    return moment.strftime("%H:%M")


def format_temp(value: float | None) -> str:
    if value is None:
        return "—"
    return str(js_round(value))


def format_percent(progress: float | None) -> str:
    if progress is None:
        return "—"
    return str(int(min(1.0, max(0.0, progress)) * 100))


def display_filename(path: str) -> str:
    name = path.split("/")[-1] if path else path
    lower = name.lower()
    for extension in (".gcode", ".gco", ".ufp", ".g"):
        if lower.endswith(extension):
            return name[: -len(extension)]
    return name


def format_speed(mm_per_s: float | None) -> str:
    if mm_per_s is None:
        return "—"
    return str(js_round(mm_per_s))


def format_flow(mm3_per_s: float | None) -> str:
    if mm3_per_s is None:
        return "—"
    quantized = js_round(mm3_per_s * 10) / 10
    if quantized == 0:
        quantized = 0.0
    return f"{quantized:.1f}"


def format_filament(mm: float | None) -> str:
    if mm is None or mm <= 0:
        return "—"
    if mm >= 1000:
        return f"{mm / 1000:.2f} m"
    return f"{js_round(mm)} mm"


def format_bytes(size: float | None) -> str:
    if size is None or size < 0:
        return "—"
    if size < 1024:
        return f"{int(size)} B"
    value = size / 1024
    units = ["KB", "MB", "GB"]
    unit = 0
    while value >= 1024 and unit < len(units) - 1:
        value /= 1024
        unit += 1
    text = str(js_round(value)) if value >= 100 else f"{value:.1f}"
    return f"{text} {units[unit]}"


def format_date(unix_seconds: float | None, *, now_ms: float, utc: bool = False) -> str:
    if unix_seconds is None:
        return "—"
    tz = timezone.utc if utc else None
    moment = datetime.fromtimestamp(unix_seconds, tz)
    now = datetime.fromtimestamp(now_ms / 1000, tz)
    clock = moment.strftime("%H:%M")
    month = moment.strftime("%b")
    if moment.year == now.year:
        return f"{moment.day} {month} {clock}"
    return f"{moment.day} {month} {moment.year}"
