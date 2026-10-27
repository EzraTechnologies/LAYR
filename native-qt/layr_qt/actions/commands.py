"""Decide whether a printer command is allowed, and the exact Moonraker request.

Pure: no sockets. The same rules as the Svelte ``prepareCommand`` path. A command
that is not allowed returns a message and no request.
"""

from __future__ import annotations

import math
import re

from layr_qt.actions.model import AXES, FALLBACK_LIMITS, heater_readings, is_homed, object_suffix
from layr_qt.moonraker.telemetry import js_round

MAX_JOG_MM = 100
Z_JOG_FLOOR_MM = 0
DEFAULT_MAX_Z_SPEED = 10
MAX_XY_JOG_SPEED = 300
MAX_EXTRUDE_MM = 100
MAX_EXTRUDE_SPEED = 15
MAX_Z_OFFSET_STEP = 0.1
MAX_Z_OFFSET_TOTAL = 2
MAX_CONSOLE_LENGTH = 256
MACRO_TIMEOUT_MS = 15 * 60_000
CONSOLE_TIMEOUT_MS = 30 * 60_000
HIGH_TEMP_CONFIRM = {"extruder": 270, "bed": 105, "other": 70}
ESTOP_GROUP = "estop"
MIN_FEEDRATE_PERCENT = 10
MAX_FEEDRATE_PERCENT = 200
SECOND = 1000

RISKY_GCODE_RE = re.compile(
    r"^(FIRMWARE_RESTART|RESTART|SAVE_CONFIG|M84|M18|G28|SET_KINEMATIC_POSITION|FORCE_MOVE|"
    r"SET_STEPPER_ENABLE|STEPPER_BUZZ|PID_CALIBRATE|Z_TILT_ADJUST|QUAD_GANTRY_LEVEL|"
    r"BED_MESH_CALIBRATE|PROBE_CALIBRATE|Z_ENDSTOP_CALIBRATE|MANUAL_PROBE)\b",
    re.IGNORECASE,
)
MACRO_NAME_RE = re.compile(r"^[A-Z0-9_]+$")
CONTROL_CHARS_RE = re.compile(r"[\u0000-\u001f\u007f]")


def fmt(value: float, digits: int = 3) -> str:
    text = f"{value:.{digits}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in {"-0", "+0", ""}:
        return "0"
    return text


def _fail(message: str) -> dict:
    return {"ok": False, "message": message}


def _ok(plan: dict) -> dict:
    plan.setdefault("confirm", None)
    plan.setdefault("note", None)
    plan.setdefault("params", None)
    return {"ok": True, "plan": plan}


def _script(lines: list[str], summary: str, group: str, timeout_ms: int, extra: dict | None = None) -> dict:
    plan = {
        "method": "printer.gcode.script",
        "params": {"script": "\n".join(lines)},
        "summary": summary,
        "group": group,
        "timeoutMs": timeout_ms,
        "confirm": None,
        "note": None,
    }
    if extra:
        plan.update(extra)
    return _ok(plan)


def _ready_gate(state: dict) -> str | None:
    if state.get("status") == "unconfigured":
        return "Set up the printer connection in Settings"
    if state.get("transport") != "connected":
        return "Printer is offline"
    klippy = state.get("klippy")
    if klippy == "ready":
        return None
    if klippy in ("shutdown", "error"):
        return "Klipper is in an error state. Restart it first"
    if klippy == "startup":
        return "Klipper is starting"
    return "Klipper is not connected"


def _host_gate(state: dict) -> str | None:
    if state.get("status") == "unconfigured":
        return "Set up the printer connection in Settings"
    if state.get("transport") != "connected":
        return "Printer is offline"
    if state.get("klippy") in ("disconnected", "unknown"):
        return "Klipper is not connected"
    return None


def _job(state: dict) -> dict | None:
    job = state.get("job")
    return job if isinstance(job, dict) else None


def _is_printing(state: dict) -> bool:
    job = _job(state)
    return bool(job and job.get("state") == "printing")


def _is_paused(state: dict) -> bool:
    job = _job(state)
    return bool(job and job.get("state") == "paused")


def _job_active(state: dict) -> bool:
    return _is_printing(state) or _is_paused(state)


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def heater_limits_for(state: dict, heater: str) -> dict:
    limits = state.get("limits") or FALLBACK_LIMITS
    if heater == "extruder":
        return limits["extruder"]
    if heater == "heater_bed":
        bed = limits.get("bed")
        return bed if bed else dict(FALLBACK_LIMITS["bed"])
    heaters = limits.get("heaters") or {}
    found = heaters.get(heater.lower())
    return found if found else {"minTemp": 0, "maxTemp": 100}


def _heater_kind(heater: str) -> str:
    if heater == "extruder":
        return "extruder"
    if heater == "heater_bed":
        return "bed"
    return "other"


def _heater_argument(heater: str) -> str:
    return object_suffix(heater) if " " in heater else heater


def jog_speed_limit(state: dict, axis: str) -> float:
    limits = state.get("limits") or {}
    if axis == "z":
        cap = limits.get("maxZVelocity")
        return min(DEFAULT_MAX_Z_SPEED if cap is None else cap, 25)
    toolhead = state.get("toolhead") or {}
    reported = toolhead.get("maxVelocity")
    if reported is None:
        reported = limits.get("maxVelocity")
    if reported is None:
        reported = 150
    return min(reported, MAX_XY_JOG_SPEED)


def jog_range(state: dict, axis: str) -> dict | None:
    toolhead = state.get("toolhead") or {}
    axis_min = toolhead.get("axisMin")
    axis_max = toolhead.get("axisMax")
    if not axis_min or not axis_max:
        return None
    index = AXES.index(axis)
    minimum = axis_min[index]
    if axis == "z":
        minimum = max(minimum, Z_JOG_FLOOR_MM)
    return {"min": minimum, "max": axis_max[index]}


def _prepare_jog(state: dict, axis: str, distance: float, speed: float) -> dict:
    if axis not in AXES:
        return _fail("Unknown axis")
    if not _finite(distance) or distance == 0:
        return _fail("Choose a distance")
    if abs(distance) > MAX_JOG_MM:
        return _fail(f"Moves are limited to {MAX_JOG_MM} mm per step")
    if not _finite(speed) or speed <= 0:
        return _fail("Choose a speed")
    if not is_homed(state, axis):
        return _fail(f"Home {axis.upper()} first")
    toolhead = state.get("toolhead") or {}
    position = toolhead.get("position")
    travel = jog_range(state, axis)
    if not position or not travel:
        return _fail("Toolhead position is not available yet")
    index = AXES.index(axis)
    current = position[index]
    target = min(travel["max"], max(travel["min"], current + distance))
    delta = js_round((target - current) * 1000) / 1000
    if abs(delta) < 0.001:
        if distance > 0:
            edge = "maximum"
            shown = travel["max"]
        elif axis == "z":
            edge = "safe minimum"
            shown = travel["min"]
        else:
            edge = "minimum"
            shown = travel["min"]
        return _fail(f"{axis.upper()} is at its {edge} ({fmt(shown, 1)} mm)")
    limited = min(speed, jog_speed_limit(state, axis))
    notes = []
    if abs(delta) < abs(distance) - 0.0005:
        notes.append(f"Limited to {fmt(abs(delta), 2)} mm by the {axis.upper()} travel limit")
    if limited < speed:
        notes.append(f"Speed limited to {fmt(limited, 1)} mm/s")
    sign = "+" if delta > 0 else ""
    return _script(
        [
            "SAVE_GCODE_STATE NAME=layr_jog",
            "G91",
            f"G1 {axis.upper()}{fmt(delta)} F{js_round(limited * 60)}",
            "RESTORE_GCODE_STATE NAME=layr_jog",
        ],
        f"Move {axis.upper()} {sign}{fmt(delta, 2)} mm",
        "motion",
        int((abs(delta) / limited) * SECOND + 30 * SECOND),
        {"note": ". ".join(notes) if notes else None, "settle": {"axis": axis, "target": target}},
    )


def _prepare_temperature(state: dict, heater: str, target: float) -> dict:
    reading = next((item for item in heater_readings(state) if item.get("object") == heater), None)
    if reading is None:
        return _fail("This heater is not available")
    if not _finite(target):
        return _fail("Enter a temperature")
    value = js_round(float(target))
    limits = heater_limits_for(state, heater)
    if value < 0:
        return _fail("Temperature cannot be negative")
    if value != 0 and (value < limits["minTemp"] or value > limits["maxTemp"]):
        return _fail(f"{reading['label']} accepts 0 or {fmt(limits['minTemp'], 0)}–{fmt(limits['maxTemp'], 0)} °C")
    confirm = None
    high = HIGH_TEMP_CONFIRM[_heater_kind(heater)]
    current_target = js_round(reading.get("target") or 0)
    if value >= high:
        confirm = {
            "title": f"Heat {reading['label']} to {value} °C?",
            "body": f"This is at or above {high} °C. Make sure the hardware and filament are rated for it.",
            "confirmLabel": f"Heat to {value} °C",
            "cancelLabel": "Go back",
            "tone": "warn",
        }
    elif _job_active(state) and value != current_target:
        phase = "paused" if _is_paused(state) else "running"
        confirm = {
            "title": f"Change {reading['label']} during the print?",
            "body": f"The target changes from {current_target} °C to {value} °C while a print is {phase}.",
            "confirmLabel": "Change temperature",
            "cancelLabel": "Go back",
            "tone": "warn",
        }
    summary = f"Turn off {reading['label']}" if value == 0 else f"Set {reading['label']} to {value} °C"
    return _script(
        [f"SET_HEATER_TEMPERATURE HEATER={_heater_argument(heater)} TARGET={value}"],
        summary,
        f"temp:{heater}",
        10 * SECOND,
        {"confirm": confirm},
    )


def _prepare_extrude(state: dict, length: float, speed: float) -> dict:
    if _is_printing(state):
        return _fail("Not available while printing. Pause first")
    if not state.get("extruder"):
        return _fail("No extruder reported")
    if not _finite(length) or length == 0:
        return _fail("Choose a length")
    extruder_limits = (state.get("limits") or FALLBACK_LIMITS)["extruder"]
    max_length = min(extruder_limits["maxExtrudeOnlyDistance"], MAX_EXTRUDE_MM)
    if abs(length) > max_length:
        return _fail(f"Limited to {fmt(max_length, 0)} mm per move")
    if not _finite(speed) or speed <= 0:
        return _fail("Choose a speed")
    minimum = extruder_limits["minExtrudeTemp"]
    temperature = state["extruder"].get("temperature")
    if state.get("canExtrude") is False or temperature is None or temperature < minimum:
        return _fail(f"Nozzle is below {fmt(minimum, 0)} °C. Heat it before extruding")
    configured = extruder_limits.get("maxExtrudeOnlyVelocity")
    max_speed = min(MAX_EXTRUDE_SPEED if configured is None else configured, MAX_EXTRUDE_SPEED)
    limited = min(speed, max_speed)
    verb = "Extrude" if length > 0 else "Retract"
    return _script(
        [
            "SAVE_GCODE_STATE NAME=layr_extrude",
            "M83",
            f"G1 E{fmt(length)} F{js_round(limited * 60)}",
            "RESTORE_GCODE_STATE NAME=layr_extrude",
        ],
        f"{verb} {fmt(abs(length), 1)} mm",
        "extrude",
        int((abs(length) / limited) * SECOND + 30 * SECOND),
        {"note": f"Speed limited to {fmt(limited, 1)} mm/s" if limited < speed else None},
    )


def _prepare_fan(state: dict, fan_name: str, speed: float) -> dict:
    fan = next((item for item in state.get("fans") or [] if item.get("object") == fan_name), None)
    if fan is None:
        return _fail("This fan is not available")
    if not fan.get("controllable"):
        return _fail(f"{fan['label']} is controlled automatically by Klipper")
    if not _finite(speed):
        return _fail("Choose a speed")
    value = min(1.0, max(0.0, float(speed)))
    percent = js_round(value * 100)
    if fan["object"] == "fan":
        line = "M107" if value == 0 else f"M106 S{js_round(value * 255)}"
    else:
        line = f"SET_FAN_SPEED FAN={object_suffix(fan['object'])} SPEED={fmt(value, 2)}"
    label = f"{fan['label']} {'off' if percent == 0 else f'{percent}%'}"
    return _script([line], label, f"fan:{fan['object']}", 10 * SECOND)


def _prepare_light(state: dict, light_name: str, value: float) -> dict:
    light = next((item for item in state.get("lights") or [] if item.get("object") == light_name), None)
    if light is None:
        return _fail("This light is not available")
    if not _finite(value):
        return _fail("Choose a brightness")
    level = min(1.0, max(0.0, float(value)))
    if not light.get("dimmable"):
        level = 1 if level >= 0.5 else 0
    name = object_suffix(light["object"])
    if light.get("kind") == "pin":
        line = f"SET_PIN PIN={name} VALUE={fmt(level * light.get('scale', 1))}"
    else:
        channel = fmt(level)
        line = f"SET_LED LED={name} RED={channel} GREEN={channel} BLUE={channel} WHITE={channel}"
    percent = js_round(level * 100)
    if percent == 0:
        text = "off"
    elif light.get("dimmable"):
        text = f"{percent}%"
    else:
        text = "on"
    return _script([line], f"{light['label']} {text}", f"light:{light['object']}", 10 * SECOND)


def _prepare_macro(state: dict, name: str) -> dict:
    macro = next((item for item in state.get("macros") or [] if item.get("name") == name), None)
    if macro is None or not MACRO_NAME_RE.match(name or ""):
        return _fail("This macro is not available")
    required = macro.get("requiredParams") or []
    if required:
        return _fail(f"{name} needs {', '.join(required)}. Open it in the console to enter values")
    parts = [macro.get("description") or "Runs this macro from your Klipper configuration."]
    if _job_active(state):
        parts.append("A print is in progress.")
    return _script(
        [name],
        f"Run {name}",
        f"macro:{name}",
        MACRO_TIMEOUT_MS,
        {
            "confirm": {
                "title": f"Run {name}?",
                "body": " ".join(parts),
                "confirmLabel": "Run macro",
                "cancelLabel": "Go back",
                "tone": "warn" if _job_active(state) else "primary",
            },
            "record": name,
        },
    )


def normalise_console_input(script: str) -> dict:
    line = (script or "").strip()
    if not line:
        return {"ok": False, "message": "Type a command"}
    if re.search(r"[\r\n]", line):
        return {"ok": False, "message": "Send one command at a time"}
    if CONTROL_CHARS_RE.search(line):
        return {"ok": False, "message": "The command contains control characters"}
    if len(line) > MAX_CONSOLE_LENGTH:
        return {"ok": False, "message": f"Commands are limited to {MAX_CONSOLE_LENGTH} characters"}
    return {"ok": True, "line": line}


def _prepare_console(state: dict, script: str) -> dict:
    normalised = normalise_console_input(script)
    if not normalised["ok"]:
        return _fail(normalised["message"])
    line = normalised["line"]
    command = line.split()[0].upper()
    if command == "M112":
        return prepare_command({"kind": "emergency_stop"}, state)
    gate = _ready_gate(state) if state.get("klippy") == "ready" else _host_gate(state)
    if gate:
        return _fail(gate)
    risky = RISKY_GCODE_RE.search(line) is not None
    notes = []
    if risky:
        notes.append("This command can move, reset or reconfigure the printer.")
    if _job_active(state):
        notes.append("A print is in progress.")
    notes.append("LAYR sends it exactly as typed.")
    return _script(
        [line],
        line,
        "console",
        CONSOLE_TIMEOUT_MS,
        {
            "confirm": {
                "title": "Send this command?",
                "body": " ".join(notes),
                "confirmLabel": "Send",
                "cancelLabel": "Go back",
                "tone": "warn" if risky or _job_active(state) else "primary",
            },
            "record": line,
        },
    )


def valid_file_path(path: str) -> bool:
    if not path or path.startswith("/") or "\\" in path:
        return False
    return all(part not in ("", ".", "..") for part in path.split("/"))


def _feedrate(code: str, label: str, percent: float) -> dict:
    if not _finite(percent):
        return _fail("Enter a percentage")
    rounded = js_round(float(percent))
    clamped = min(MAX_FEEDRATE_PERCENT, max(MIN_FEEDRATE_PERCENT, rounded))
    return _script(
        [f"{code} S{clamped}"],
        f"{label} {clamped}%",
        "feedrate",
        10 * SECOND,
        {"note": None if clamped == rounded else f"Limited to {clamped}%"},
    )


def connection_block(state: dict) -> str | None:
    """Why ordinary controls are unavailable, or None when Klipper is ready."""
    return _ready_gate(state)


def host_block(state: dict) -> str | None:
    """Why emergency stop and restarts are unavailable."""
    return _host_gate(state)


def prepare_command(command: dict, state: dict) -> dict:
    kind = command.get("kind")
    if kind == "emergency_stop":
        gate = _host_gate(state)
        if gate:
            return _fail(gate)
        return _ok(
            {
                "method": "printer.emergency_stop",
                "params": None,
                "summary": "Emergency stop",
                "group": ESTOP_GROUP,
                "timeoutMs": 10 * SECOND,
            }
        )
    if kind in ("firmware_restart", "restart"):
        gate = _host_gate(state)
        if gate:
            return _fail(gate)
        firmware = kind == "firmware_restart"
        return _ok(
            {
                "method": "printer.firmware_restart" if firmware else "printer.restart",
                "params": None,
                "summary": "Firmware restart" if firmware else "Restart Klipper",
                "group": "restart",
                "timeoutMs": 30 * SECOND,
                "confirm": {
                    "title": "Restart firmware?" if firmware else "Restart Klipper?",
                    "body": (
                        f"{'Resets every MCU and reloads the configuration.' if firmware else 'Reloads the Klipper configuration on the host.'} "
                        "Heaters turn off, axes need homing and any print in progress is lost."
                    ),
                    "confirmLabel": "Firmware restart" if firmware else "Restart",
                    "cancelLabel": "Go back",
                    "tone": "danger" if _job_active(state) else "warn",
                },
            }
        )
    if kind == "delete_file":
        if state.get("status") == "unconfigured" or state.get("transport") != "connected":
            return _fail("Printer is offline")
        path = command.get("path") or ""
        if not valid_file_path(path):
            return _fail("Invalid file path")
        job = _job(state)
        if _job_active(state) and job and job.get("filename") == path:
            return _fail("This file is being printed")
        leaf = path.split("/")[-1]
        return _ok(
            {
                "method": "server.files.delete_file",
                "params": {"path": f"gcodes/{path}"},
                "summary": f"Delete {leaf}",
                "group": f"file:{path}",
                "timeoutMs": 15 * SECOND,
                "follow": "directory",
                "confirm": {
                    "title": "Delete this file?",
                    "body": f"{path} will be removed from the printer. This cannot be undone.",
                    "confirmLabel": "Delete",
                    "cancelLabel": "Go back",
                    "tone": "danger",
                },
            }
        )
    if kind == "gcode":
        return _prepare_console(state, command.get("script") or "")

    gate = _ready_gate(state)
    if gate:
        return _fail(gate)

    if kind == "pause":
        if not _is_printing(state):
            return _fail("No print is running")
        return _ok({"method": "printer.print.pause", "params": None, "summary": "Pause print", "group": "print", "timeoutMs": 60 * SECOND})
    if kind == "resume":
        if not _is_paused(state):
            return _fail("The print is not paused")
        return _ok({"method": "printer.print.resume", "params": None, "summary": "Resume print", "group": "print", "timeoutMs": 60 * SECOND})
    if kind == "cancel":
        if not _job_active(state):
            return _fail("No print is running")
        job = _job(state)
        name = (job or {}).get("filename") or "The current job"
        return _ok(
            {
                "method": "printer.print.cancel",
                "params": None,
                "summary": "Cancel print",
                "group": "print",
                "timeoutMs": 120 * SECOND,
                "confirm": {
                    "title": "Cancel this print?",
                    "body": f"{name} will stop and cannot be resumed.",
                    "confirmLabel": "Cancel print",
                    "cancelLabel": "Keep printing",
                    "tone": "danger",
                },
            }
        )
    if kind == "start_print":
        filename = command.get("filename") or ""
        job = _job(state)
        if _job_active(state) and job and job.get("filename") == filename:
            return _fail("This file is the active print")
        if _job_active(state):
            return _fail("A print is already in progress")
        if not valid_file_path(filename):
            return _fail("Invalid file path")
        return _ok(
            {
                "method": "printer.print.start",
                "params": {"filename": filename},
                "summary": f"Start {filename.split('/')[-1]}",
                "group": "print",
                "timeoutMs": 60 * SECOND,
                "confirm": {
                    "title": "Start this print?",
                    "body": f"{filename} will start now. Check that the bed is clear and the right filament is loaded.",
                    "confirmLabel": "Start print",
                    "cancelLabel": "Go back",
                    "tone": "primary",
                },
            }
        )
    if kind == "home":
        if _job_active(state):
            return _fail("Not available during a print")
        requested = [axis for axis in AXES if axis in (command.get("axes") or [])]
        only_z = bool(requested) and all(axis == "z" for axis in requested)
        if only_z and not (is_homed(state, "x") and is_homed(state, "y")):
            return _fail("Home X and Y first, or use Home all")
        if not requested or len(requested) == 3:
            args = ""
        else:
            args = " " + " ".join(axis.upper() for axis in requested)
        summary = "Home all axes" if not args else f"Home{args}"
        return _script([f"G28{args}"], summary, "motion", 180 * SECOND)
    if kind == "jog":
        if _job_active(state):
            return _fail("Not available during a print")
        return _prepare_jog(state, str(command.get("axis") or ""), float(command.get("distance") or 0), float(command.get("speed") or 0))
    if kind == "motors_off":
        if _job_active(state):
            return _fail("Not available during a print")
        return _script(
            ["M84"],
            "Disable motors",
            "motion",
            10 * SECOND,
            {
                "confirm": {
                    "title": "Disable stepper motors?",
                    "body": "All axes will need homing again before they can be moved.",
                    "confirmLabel": "Disable motors",
                    "cancelLabel": "Go back",
                    "tone": "warn",
                }
            },
        )
    if kind == "set_speed_factor":
        return _feedrate("M220", "Speed override", command.get("percent"))
    if kind == "set_extrude_factor":
        return _feedrate("M221", "Flow override", command.get("percent"))
    if kind == "z_offset":
        delta = command.get("delta")
        if not _finite(delta) or delta == 0:
            return _fail("Choose a step")
        delta = float(delta)
        if abs(delta) > MAX_Z_OFFSET_STEP:
            return _fail(f"Steps are limited to {MAX_Z_OFFSET_STEP} mm")
        if not is_homed(state, "z"):
            return _fail("Home Z first")
        current = ((state.get("toolhead") or {}).get("zOffset")) or 0
        if abs(current + delta) > MAX_Z_OFFSET_TOTAL:
            return _fail(f"Z offset is limited to ±{MAX_Z_OFFSET_TOTAL} mm")
        sign = "+" if delta > 0 else ""
        return _script(
            [f"SET_GCODE_OFFSET Z_ADJUST={fmt(delta)} MOVE=1"],
            f"Z offset {sign}{fmt(delta)} mm",
            "zoffset",
            30 * SECOND,
        )
    if kind == "extrude":
        return _prepare_extrude(state, float(command.get("length") or 0), float(command.get("speed") or 0))
    if kind == "set_temperature":
        return _prepare_temperature(state, str(command.get("heater") or ""), command.get("target"))
    if kind == "set_fan":
        return _prepare_fan(state, str(command.get("fan") or ""), command.get("speed"))
    if kind == "set_light":
        return _prepare_light(state, str(command.get("light") or ""), command.get("value"))
    if kind == "macro":
        return _prepare_macro(state, str(command.get("name") or ""))
    return _fail("This action is not available")
