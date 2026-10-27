"""Turn assembled printer data into the strings QML binds to."""

from __future__ import annotations

from typing import Any

from .formatutil import display_filename, format_bytes, format_duration, format_flow, format_percent, format_speed, format_temp
from .mapping import derive_status, map_fans, map_job, map_temperatures, map_toolhead, parse_job_state
from .telemetry import map_motion

STATUS_LABEL = {
    "unconfigured": "Not set up",
    "disconnected": "Offline",
    "connecting": "Connecting",
    "ready": "Ready",
    "printing": "Printing",
    "paused": "Paused",
    "error": "Error",
}

STATUS_TONE = {
    "unconfigured": "dim",
    "disconnected": "dim",
    "connecting": "purple",
    "ready": "ok",
    "printing": "cyan",
    "paused": "warn",
    "error": "danger",
}


def _heater(reading: dict[str, Any] | None, empty_label: str) -> dict[str, str]:
    if reading is None or reading.get("temperature") is None:
        return {"temp": "—", "target": "", "caption": empty_label}
    target = reading.get("target")
    target_text = "" if target is None else f"target {format_temp(target)}°"
    return {"temp": format_temp(reading.get("temperature")), "target": target_text, "caption": reading.get("label") or ""}


def _can_extrude(raw: dict[str, Any]) -> str:
    extruder = raw.get("extruder")
    if not isinstance(extruder, dict) or "can_extrude" not in extruder:
        return ""
    return "yes" if extruder.get("can_extrude") is True else "no"


def headline(status: str, job: dict[str, Any] | None) -> str:
    if status == "printing" and job is not None and (job.get("printDuration") or 0) == 0:
        return "Preparing"
    if status == "ready" and job is not None and job.get("state") == "complete":
        return "Print complete"
    if status == "ready" and job is not None and job.get("state") == "cancelled":
        return "Print cancelled"
    return STATUS_LABEL.get(status, status)


def present(model: dict[str, Any]) -> dict[str, Any]:
    """Build a JSON-safe snapshot. Disconnected printers do not keep stale numbers."""
    configured = (model.get("displayName") or "").strip()
    hostname = model.get("hostname")
    connected = model.get("transport") == "connected" and model.get("klippy") == "ready"
    raw = model.get("raw") if connected and isinstance(model.get("raw"), dict) else {}
    settings = model.get("settings") if connected and isinstance(model.get("settings"), dict) else {}
    job = map_job(raw, model.get("slicerEstimate"))
    temps = map_temperatures(raw)
    toolhead = map_toolhead(raw)
    fans = map_fans(raw)
    motion = map_motion(raw, settings)
    job_state = parse_job_state(raw.get("print_stats", {}).get("state")) if isinstance(raw.get("print_stats"), dict) else None
    if model.get("unconfigured"):
        derived = {"status": "unconfigured", "detail": "Set a Moonraker URL in Settings"}
    else:
        derived = derive_status(
            str(model.get("transport") or "idle"),
            str(model.get("klippy") or "unknown"),
            job_state,
            model.get("klippyMessage"),
            job.get("message") if job else None,
        )
        if model.get("transport") == "waiting":
            reason = model.get("transportReason") or "Connection lost"
            derived = {"status": "disconnected", "detail": f"{reason}. Retrying automatically"}

    status = str(derived["status"])
    active = status in {"printing", "paused"}
    show_job = job is not None and status in {"ready", "printing", "paused", "error"}
    layer = "—"
    if job and job.get("currentLayer") is not None and job.get("totalLayers"):
        layer = f"{int(job['currentLayer'])} / {int(job['totalLayers'])}"
    elif job and job.get("currentLayer") is not None:
        layer = str(int(job["currentLayer"]))

    position = "—"
    homed = "—"
    if toolhead is not None:
        homed = (toolhead.get("homedAxes") or "").upper() or "not homed"
        pos = toolhead.get("position")
        if pos:
            position = f"X {pos[0]:.1f}   Y {pos[1]:.1f}   Z {pos[2]:.1f}"

    flow_gap = motion["flowGap"]
    if flow_gap == "diameter":
        flow_caption = "No filament diameter in Klipper config"
    elif flow_gap == "velocity":
        flow_caption = "motion_report.live_extruder_velocity unavailable"
    elif motion["flowMm3S"] is not None and motion["flowMm3S"] < 0:
        flow_caption = "Retracting"
    else:
        diameter = motion["filamentDiameterMm"]
        flow_caption = f"Ø {diameter:g} mm" if diameter else "Live volumetric flow"

    fan_rows = []
    for fan in fans:
        speed = fan.get("speed")
        percent = "—" if speed is None else f"{round(speed * 100)}%"
        fan_rows.append({"label": fan["label"], "value": percent})

    def factor_text(value: Any) -> str:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return "—"
        return f"{round(float(value) * 100)}%"

    speed_factor = factor_text(toolhead.get("speedFactor") if toolhead else None)
    extrude_factor = factor_text(toolhead.get("extrudeFactor") if toolhead else None)

    filename = job["filename"] if job else ""
    return {
        "printerName": configured or hostname or "Klipper printer",
        "hostname": hostname or "",
        "status": status,
        "statusLabel": headline(status, job),
        "statusTone": STATUS_TONE.get(status, "dim"),
        "statusDetail": derived.get("detail") or "",
        "connected": connected,
        "showJob": bool(show_job and filename),
        "filename": display_filename(filename) if filename else "",
        "filenameFull": filename,
        "progress": job["progress"] if job and job.get("progress") is not None else 0,
        "progressText": format_percent(job["progress"]) if job else "—",
        "elapsedText": format_duration(job["totalDuration"]) if job else "—",
        "remainingText": format_duration(job["remaining"]) if active and job else "—",
        "remainingSource": job.get("remainingSource") if active and job else "",
        "layerText": layer,
        "speedText": format_speed(motion["speedMmS"]),
        "flowText": format_flow(motion["flowMm3S"]),
        "flowCaption": flow_caption,
        "speedCaption": "motion_report.live_velocity",
        "nozzle": _heater(temps["extruder"], "No data" if not connected else "Not configured"),
        "bed": _heater(temps["bed"], "No data" if not connected else "Not configured"),
        "chamber": _heater(temps["chamber"], "No chamber sensor" if connected else "No data"),
        "positionText": position,
        "homedText": homed,
        "speedFactorText": speed_factor,
        "extrudeFactorText": extrude_factor,
        "fans": fan_rows,
        "canExtrude": _can_extrude(raw),
        "reconnectAttempt": int(model.get("reconnectAttempt") or 0),
        "readOnly": True,
    }


def present_files(listing: dict[str, Any] | None, directory: str, message: str = "") -> dict[str, Any]:
    dirs = []
    files = []
    if listing:
        for entry in listing.get("dirs") or []:
            dirs.append({"kind": "dir", "name": entry["name"], "path": entry["path"], "meta": "Folder"})
        for entry in listing.get("files") or []:
            meta = entry.get("meta") or {}
            bits = []
            if meta.get("estimatedTime"):
                bits.append(format_duration(meta["estimatedTime"]))
            if entry.get("size") is not None:
                bits.append(format_bytes(entry["size"]))
            if meta.get("filamentType"):
                bits.append(meta["filamentType"])
            files.append(
                {
                    "kind": "file",
                    "name": entry["name"],
                    "path": entry["path"],
                    "meta": " · ".join(bits) if bits else "No slicer metadata",
                }
            )
    return {"directory": directory, "message": message, "entries": [*dirs, *files]}
