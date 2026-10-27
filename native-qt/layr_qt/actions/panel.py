"""View fields for the touch controls. Availability comes from ``prepare_command``."""

from __future__ import annotations

from layr_qt.actions.commands import connection_block, heater_limits_for, host_block, prepare_command
from layr_qt.actions.model import (
    LOAD_MACROS,
    UNLOAD_MACROS,
    build_snapshot,
    find_macro,
    heater_readings,
    is_homed,
)
from layr_qt.moonraker.telemetry import js_round

NOZZLE_PRESETS = (180, 200, 210, 230, 250, 270)
BED_PRESETS = (50, 60, 70, 80, 100, 110)
JOG_STEPS = (0.1, 1, 10, 25, 50)
XY_SPEEDS = (25, 50, 100, 150)
BABY_STEPS = (0.01, 0.05)


def _allowed(command: dict, state: dict, *, fixture: bool) -> dict:
    if fixture:
        return {"allowed": False, "message": "Fixture mode does not connect to a printer."}
    prepared = prepare_command(command, state)
    if prepared["ok"]:
        return {"allowed": True, "message": prepared["plan"].get("note") or ""}
    return {"allowed": False, "message": prepared["message"]}


def _presets(heater: str, limits: dict) -> list[int]:
    source = NOZZLE_PRESETS if heater == "extruder" else BED_PRESETS if heater == "heater_bed" else ()
    return [value for value in source if limits["minTemp"] <= value <= limits["maxTemp"]]


def file_flags(state: dict, path: str, *, fixture: bool) -> dict:
    start = _allowed({"kind": "start_print", "filename": path}, state, fixture=fixture)
    delete = _allowed({"kind": "delete_file", "path": path}, state, fixture=fixture)
    note = ""
    if not start["allowed"]:
        note = start["message"]
    elif not delete["allowed"]:
        note = delete["message"]
    return {
        "canStart": start["allowed"],
        "canDelete": delete["allowed"],
        "startReason": "" if start["allowed"] else start["message"],
        "deleteReason": "" if delete["allowed"] else delete["message"],
        "note": note,
    }


def panel_from_snapshot(state: dict, ui: dict | None, *, fixture: bool) -> dict:
    ui = ui or {}
    printing = bool(state.get("job") and state["job"].get("state") == "printing")
    paused = bool(state.get("job") and state["job"].get("state") == "paused")
    if fixture:
        ready = False
        host = False
        reason = "Fixture mode does not connect to a printer."
    else:
        blocked = connection_block(state)
        hosted = host_block(state)
        ready = blocked is None
        host = hosted is None
        reason = blocked or ""
    toolhead = state.get("toolhead") or {}
    limits = state.get("limits") or {}
    xy_cap = toolhead.get("maxVelocity") or limits.get("maxVelocity") or 150
    xy_speeds = [speed for speed in XY_SPEEDS if speed <= xy_cap]
    if not xy_speeds:
        xy_speeds = [max(1, int(min(xy_cap, 25)))]
    z_cap = limits.get("maxZVelocity")
    z_speed = 10 if z_cap is None else min(z_cap, 10)
    extruder_limits = limits.get("extruder") or {}
    max_length = min(extruder_limits.get("maxExtrudeOnlyDistance") or 50, 100)
    lengths = [value for value in (5, 10, 25, 50, 100) if value <= max_length]
    if not lengths:
        lengths = [max(1, int(max_length))]
    max_extrude_speed = extruder_limits.get("maxExtrudeOnlyVelocity") or 15
    extrude_speeds = [value for value in (2, 5, 10, 15) if value <= max_extrude_speed]
    if not extrude_speeds:
        extrude_speeds = [1]
    heaters = []
    for reading in heater_readings(state):
        bounds = heater_limits_for(state, reading["object"])
        heaters.append(
            {
                "object": reading["object"],
                "label": reading["label"],
                "value": "—" if reading.get("temperature") is None else str(js_round(reading["temperature"])),
                "target": "" if reading.get("target") is None else str(js_round(reading["target"])),
                "min": bounds["minTemp"],
                "max": bounds["maxTemp"],
                "presets": _presets(reading["object"], bounds),
            }
        )
    macros = []
    hidden = 0
    show_hidden = bool(ui.get("showHidden"))
    for macro in state.get("macros") or []:
        if macro.get("hidden"):
            hidden += 1
            if not show_hidden:
                continue
        macros.append(
            {
                "name": macro["name"],
                "description": macro.get("description") or "",
                "needsParams": bool(macro.get("requiredParams")),
            }
        )
    load_name = find_macro(state.get("macros") or [], LOAD_MACROS)
    unload_name = find_macro(state.get("macros") or [], UNLOAD_MACROS)
    extrude = _allowed({"kind": "extrude", "length": lengths[0], "speed": extrude_speeds[0]}, state, fixture=fixture)
    fans = []
    for fan in state.get("fans") or []:
        speed = fan.get("speed")
        fans.append(
            {
                "object": fan["object"],
                "label": fan["label"],
                "percent": 0 if speed is None else js_round(speed * 100),
                "controllable": bool(fan.get("controllable")),
            }
        )
    lights = []
    for light in state.get("lights") or []:
        value = light.get("value")
        lights.append(
            {
                "object": light["object"],
                "label": light["label"],
                "percent": 0 if value is None else js_round(value * 100),
                "dimmable": bool(light.get("dimmable")),
            }
        )
    homed = "".join(axis.upper() for axis in ("x", "y", "z") if is_homed(state, axis))
    confirm = ui.get("confirm")
    if confirm and "cancelLabel" not in confirm:
        confirm = {**confirm, "cancelLabel": "Go back"}
    if fixture:
        mode = "Fixture"
    elif ready:
        mode = "Live"
    else:
        mode = "Offline"
    return {
        "modeLabel": mode,
        "readOnly": fixture or not ready,
        "gate": {
            "ready": ready,
            "host": host,
            "printing": printing,
            "paused": paused,
            "busy": list(ui.get("busy") or []),
            "reason": reason,
        },
        "confirm": confirm,
        "toast": ui.get("toast"),
        "console": list(ui.get("console") or []),
        "consoleDraft": ui.get("consoleDraft") or "",
        "move": {
            "homed": homed or "Not homed",
            "position": _position_text(toolhead.get("position")),
            "zOffset": "—" if toolhead.get("zOffset") is None else f"{toolhead['zOffset']:.3f}",
            "steps": list(JOG_STEPS),
            "xySpeeds": xy_speeds,
            "zSpeed": z_speed,
            "babySteps": list(BABY_STEPS),
            "canJog": _allowed({"kind": "jog", "axis": "x", "distance": 1, "speed": xy_speeds[0]}, state, fixture=fixture)["allowed"]
            or _allowed({"kind": "jog", "axis": "y", "distance": 1, "speed": xy_speeds[0]}, state, fixture=fixture)["allowed"]
            or _allowed({"kind": "jog", "axis": "z", "distance": 1, "speed": z_speed}, state, fixture=fixture)["allowed"],
            "canHome": _allowed({"kind": "home", "axes": ["x", "y", "z"]}, state, fixture=fixture)["allowed"],
            "canBaby": _allowed({"kind": "z_offset", "delta": 0.01}, state, fixture=fixture)["allowed"],
            "canMotors": _allowed({"kind": "motors_off"}, state, fixture=fixture)["allowed"],
        },
        "heat": {
            "heaters": heaters,
            "extrudeLengths": lengths,
            "extrudeSpeeds": extrude_speeds,
            "canExtrude": extrude["allowed"],
            "extrudeReason": "" if extrude["allowed"] else extrude["message"],
            "loadMacro": "" if fixture else load_name,
            "unloadMacro": "" if fixture else unload_name,
            "fans": fans,
            "lights": lights,
        },
        "macros": macros,
        "hiddenMacros": hidden,
        "showHidden": show_hidden,
    }


def _position_text(position: list | None) -> str:
    if not position or len(position) < 3:
        return "—"
    return f"X {position[0]:.1f}    Y {position[1]:.1f}    Z {position[2]:.2f}"


def attach_panel(store, prefs: dict, *, fixture: bool, ui: dict | None) -> dict:
    configured = bool((prefs or {}).get("moonrakerUrl"))
    state = build_snapshot(store, configured=configured)
    return state, panel_from_snapshot(state, ui, fixture=fixture)
