"""Build the JSON document the QML shell renders."""

from __future__ import annotations

from layr_qt.moonraker.status import (
    STATUS_META,
    derive_status,
    display_filename,
    format_bytes,
    format_clock,
    format_date,
    format_duration,
    format_filament,
    format_flow,
    format_percent,
    format_speed,
    format_temp,
    headline,
    map_fans,
    map_job,
    map_temperatures,
    map_toolhead,
    parse_job_state,
)
from layr_qt.moonraker.telemetry import js_round, map_motion
from layr_qt.actions.panel import attach_panel, file_flags
from layr_qt.preferences import resolve_printer_name
from layr_qt.spoolman.model import empty_spool_view
from layr_qt.store import PrinterStore

PAGES = ("home", "move", "heat", "files", "filament", "more", "settings")


def canonical_page(page: str) -> str | None:
    if page == "controls":
        return "move"
    if page in PAGES:
        return page
    return None


def _temp_card(reading: dict | None, label: str, missing: str) -> dict:
    if reading is None or reading.get("temperature") is None:
        return {"label": label, "value": "—", "target": "", "power": 0, "missing": missing}
    target = reading.get("target")
    power = reading.get("power")
    return {
        "label": label,
        "value": format_temp(reading.get("temperature")),
        "target": "" if target is None else f"target {format_temp(target)}°",
        "power": 0 if power is None else power,
        "missing": "",
    }


def _factor_percent(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{js_round(value * 100)}%"


def _motion_view(motion: dict, live: bool) -> dict:
    if not live:
        return {
            "speedText": "—",
            "flowText": "—",
            "retracting": False,
            "speedCaption": "No data",
            "flowCaption": "No data",
            "diameterText": "",
        }
    speed = motion.get("speedMmS")
    flow = motion.get("flowMm3S")
    gap = motion.get("flowGap")
    diameter = motion.get("filamentDiameterMm")
    if speed is None:
        speed_caption = "Klipper did not report live_velocity"
    else:
        speed_caption = "live_velocity, mm/s"
    if gap == "diameter":
        flow_caption = "No filament diameter"
    elif gap == "velocity":
        flow_caption = "No extruder velocity"
    elif flow is not None and flow < 0:
        flow_caption = "Retracting"
    else:
        flow_caption = "live_extruder_velocity × area"
    return {
        "speedText": format_speed(speed),
        "flowText": format_flow(flow),
        "retracting": flow is not None and flow < 0,
        "speedCaption": speed_caption,
        "flowCaption": flow_caption,
        "diameterText": "" if diameter is None else f"{diameter:g} mm filament",
    }


def _job_view(job: dict | None, status: str, thumbnail: str | None, now_ms: float, utc: bool) -> dict:
    empty = {
        "visible": False,
        "filename": "",
        "displayName": "",
        "progress": 0,
        "progressText": "—",
        "elapsed": "—",
        "remaining": "—",
        "remainingNote": "",
        "eta": "—",
        "layer": "—",
        "filament": "—",
        "message": "",
        "thumbnailKey": "",
        "active": False,
        "headline": "",
    }
    if job is None:
        return empty
    active = status in ("printing", "paused")
    eta = "—"
    if status == "printing" and job.get("remaining") is not None:
        eta = format_clock(now_ms + job["remaining"] * 1000, utc=utc)
    current = job.get("currentLayer")
    total = job.get("totalLayers")
    if current is not None and total is not None and total > 0:
        layer = f"{int(current)} / {int(total)}"
    elif current is not None:
        layer = str(int(current))
    else:
        layer = "—"
    return {
        "visible": True,
        "filename": job["filename"],
        "displayName": display_filename(job["filename"]),
        "progress": job.get("progress") or 0,
        "progressText": format_percent(job.get("progress")),
        "elapsed": format_duration(job.get("totalDuration")),
        "remaining": format_duration(job.get("remaining")) if active else "—",
        "remainingNote": "est." if active and job.get("remainingSource") == "slicer" else "",
        "eta": eta,
        "layer": layer,
        "filament": format_filament(job.get("filamentUsed")),
        "message": job.get("message") or "",
        "thumbnailKey": thumbnail or "",
        "active": active,
        "headline": headline(status, job),
    }


def _file_detail(entry: dict | None, now_ms: float, utc: bool) -> str:
    if entry is None:
        return ""
    parts = []
    modified = entry.get("modified")
    if modified is not None:
        parts.append(format_date(modified, now_ms=now_ms, utc=utc))
    size = entry.get("size")
    if size is not None:
        parts.append(format_bytes(size))
    return " · ".join(parts)


def _selected(store: PrinterStore, now_ms: float, utc: bool) -> dict | None:
    if not store.selected_path:
        return None
    entry = store.file_entry(store.selected_path)
    if entry is None:
        return None
    meta = entry.get("meta") or {}
    thumb = ""
    thumbs = meta.get("thumbnails") if isinstance(meta, dict) else None
    if isinstance(thumbs, list) and thumbs:
        best = max(thumbs, key=lambda item: item.get("width") or 0)
        thumb = best.get("path") or ""
    estimated = meta.get("estimatedTime") if isinstance(meta, dict) else None
    filament = meta.get("filamentTotal") if isinstance(meta, dict) else None
    return {
        "name": entry.get("name") or "",
        "path": entry.get("path") or "",
        "estimated": format_duration(estimated),
        "filament": format_filament(filament),
        "slicer": (meta.get("slicer") if isinstance(meta, dict) else None) or "—",
        "thumb": thumb,
        "note": "",
        "canStart": False,
        "canDelete": False,
    }


def build_view(
    store: PrinterStore,
    prefs: dict,
    *,
    now_ms: float,
    perf: dict,
    page: str,
    dimmed: bool = False,
    settings_error: str = "",
    fixture: bool = False,
    utc: bool = False,
    ui: dict | None = None,
    spoolman=None,
) -> dict:
    live = store.transport == "connected" and store.klippy == "ready"
    raw = store.raw if live else {}
    settings = store.settings if live else {}
    job = map_job(raw, store.slicer_estimate if live else None)
    stats = raw.get("print_stats") if isinstance(raw.get("print_stats"), dict) else None
    job_state = parse_job_state(stats.get("state")) if stats else None
    derived = derive_status(store.transport, store.klippy, job_state, store.klippy_message, job.get("message") if job else None)
    if store.transport == "waiting" and store.reason:
        derived = {"status": "disconnected", "detail": f"{store.reason}. Retrying automatically"}
    status = derived["status"]
    meta = STATUS_META[status]
    name, source = resolve_printer_name(prefs.get("displayName") or "", store.hostname if live or store.hostname else None)
    temps = map_temperatures(raw)
    motion = map_motion(raw, settings)
    toolhead = map_toolhead(raw) if live else None
    unavailable = "No data" if not live else "Not configured"
    chamber_missing = "No chamber sensor" if live else unavailable
    position = "—"
    homed = "Not homed"
    max_velocity = "—"
    if toolhead is not None:
        axes = toolhead.get("homedAxes") or ""
        homed = " ".join(axis.upper() for axis in ("x", "y", "z") if axis in axes) or "Not homed"
        coords = toolhead.get("position")
        if coords:
            position = f"X {coords[0]:.1f}    Y {coords[1]:.1f}    Z {coords[2]:.2f}"
        if toolhead.get("maxVelocity") is not None:
            max_velocity = f"{toolhead['maxVelocity']:g} mm/s limit"
    files = []
    for entry in store.files:
        files.append(
            {
                "name": display_filename(entry.get("name") or ""),
                "path": entry.get("path") or "",
                "detail": _file_detail(entry, now_ms, utc),
                "selected": entry.get("path") == store.selected_path,
            }
        )
    hostname_hint = f"Klipper host name: {store.hostname}" if store.hostname else "Klipper host name: —"
    shown_page = canonical_page(page) or "home"
    speed_number = None if toolhead is None or toolhead.get("speedFactor") is None else js_round(toolhead["speedFactor"] * 100)
    flow_number = None if toolhead is None or toolhead.get("extrudeFactor") is None else js_round(toolhead["extrudeFactor"] * 100)
    view = {
        "page": shown_page,
        "theme": prefs.get("theme") or "midnight",
        "hideCursor": bool(prefs.get("hideCursor", True)),
        "dimmed": dimmed,
        "readOnly": True,
        "fixture": fixture,
        "printerName": name,
        "nameSource": source,
        "hostname": store.hostname or "",
        "status": status,
        "statusLabel": meta["label"],
        "headline": headline(status, job) if live else meta["label"],
        "statusDetail": derived.get("detail") or "",
        "tone": meta["tone"],
        "transport": store.transport,
        "klippy": store.klippy,
        "attempt": store.attempt,
        "job": _job_view(job if live else None, status, store.thumbnail_path if live else None, now_ms, utc),
        "motion": _motion_view(motion, live),
        "temps": [
            _temp_card(temps["extruder"], "Nozzle", unavailable),
            _temp_card(temps["bed"], "Bed", unavailable),
            _temp_card(temps["chamber"], "Chamber", chamber_missing),
        ],
        "fans": [
            {"label": fan["label"], "text": "—" if fan["speed"] is None else f"{js_round(fan['speed'] * 100)}%"}
            for fan in map_fans(raw)
        ],
        "toolhead": {"homed": homed, "position": position, "maxVelocity": max_velocity},
        "overrides": {
            "speed": _factor_percent(None if toolhead is None else toolhead.get("speedFactor")),
            "flow": _factor_percent(None if toolhead is None else toolhead.get("extrudeFactor")),
            "speedNumber": speed_number,
            "flowNumber": flow_number,
            "note": "M220 and M221 multipliers. They are not the live mm/s or mm³/s on Home.",
        },
        "files": {
            "path": store.directory_relative,
            "dirs": [{"name": item["name"], "path": item["path"]} for item in store.dirs],
            "files": files,
            "error": store.directory_error,
            "selected": _selected(store, now_ms, utc),
        },
        "settings": {
            "displayName": prefs.get("displayName") or "",
            "moonrakerUrl": prefs.get("moonrakerUrl") or "",
            "theme": prefs.get("theme") or "midnight",
            "hideCursor": bool(prefs.get("hideCursor", True)),
            "dimAfterMinutes": prefs.get("dimAfterMinutes") or 0,
            "error": settings_error,
            "hostnameHint": hostname_hint,
        },
        "perf": perf,
        "connectionTitle": _connection_title(status, store.klippy),
    }
    state, panel = attach_panel(store, prefs, fixture=fixture, ui=ui)
    view.update(panel)
    gate = panel.get("gate") or {}
    printing = bool(gate.get("printing") or gate.get("paused"))
    unload_macros = [item for item in panel.get("macros") or [] if not item.get("needsParams")]
    if spoolman is None:
        view["spoolman"] = empty_spool_view()
        view["spool"] = {"visible": False, "text": "", "color": ""}
    else:
        view["spoolman"] = spoolman.view(printing=printing, printer_label=name, unload_macros=unload_macros)
        view["spool"] = spoolman.home_chip()
    selected = view["files"]["selected"]
    if selected:
        selected.update(file_flags(state, selected.get("path") or "", fixture=fixture))
        if not selected.get("note"):
            selected["note"] = "Check the bed and filament before starting."
    return view


def _connection_title(status: str, klippy: str) -> str:
    if status == "error":
        return "Printer reports an error"
    if status == "connecting":
        return "Connecting to printer"
    if klippy == "disconnected":
        return "Klipper is not running"
    if status == "disconnected":
        return "Printer is offline"
    if status == "ready":
        return "Ready to print"
    return STATUS_META.get(status, STATUS_META["disconnected"])["label"]
