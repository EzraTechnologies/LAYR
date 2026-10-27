"""Command gateway tests. No Qt and no network. Exact Moonraker requests only."""

from __future__ import annotations

import json

import pytest

from layr_qt.actions.commands import prepare_command
from layr_qt.controller import Controller
from layr_qt.moonraker.protocol import MethodNotAllowedError, encode_request, plan_subscription
from layr_qt.moonraker.session import MoonrakerSession
from layr_qt.store import PrinterStore

from test_logic import ZeroRng


def _store(*, homed="xyz", printing=False, temp=210.0, can=True, filename=""):
    store = PrinterStore()
    store.transport = "connected"
    store.klippy = "ready"
    job_name = filename or ("jobs/part.gcode" if printing else "")
    job_state = "printing" if printing else "standby"
    store.raw = {
        "extruder": {"temperature": temp, "target": 200, "power": 0.2, "can_extrude": can},
        "heater_bed": {"temperature": 60, "target": 60, "power": 0.1},
        "heater_generic chamber": {"temperature": 40, "target": 0, "power": 0},
        "toolhead": {
            "homed_axes": homed,
            "position": [10, 20, 5, 0],
            "axis_minimum": [0, 0, -2, 0],
            "axis_maximum": [300, 300, 280, 0],
            "max_velocity": 300,
            "extruder": "extruder",
        },
        "gcode_move": {"homing_origin": [0, 0, 0], "speed_factor": 1, "extrude_factor": 1},
        "print_stats": {"filename": job_name, "state": job_state},
        "fan": {"speed": 0.5},
        "heater_fan hotend_fan": {"speed": 1},
        "controller_fan board": {"speed": 1},
        "fan_generic nevermore": {"speed": 0.25},
        "led case": {"color_data": [[0.2, 0.2, 0.2, 0.2]]},
    }
    store.settings = {
        "extruder": {
            "max_temp": 300,
            "min_temp": 10,
            "min_extrude_temp": 170,
            "max_extrude_only_distance": 50,
            "filament_diameter": 1.75,
        },
        "heater_bed": {"max_temp": 120, "min_temp": 0},
        "heater_generic chamber": {"max_temp": 70, "min_temp": 0},
        "printer": {"max_velocity": 300, "max_z_velocity": 15},
        "gcode_macro load_filament": {"gcode": "LOAD"},
        "gcode_macro print_start": {"gcode": "START", "description": "Start a print"},
        "gcode_macro needs_temp": {"gcode": "M104 S{params.TEMP}"},
        "gcode_macro _secret": {"gcode": "G4 P1"},
        "led case": {},
    }
    if job_name:
        store.metadata_for = job_name
    store.objects = [
        "gcode_macro load_filament",
        "gcode_macro print_start",
        "gcode_macro needs_temp",
        "gcode_macro _secret",
        "extruder",
        "heater_bed",
        "fan",
        "heater_fan hotend_fan",
        "fan_generic nevermore",
        "led case",
    ]
    return store


def _controller(store=None):
    store = store or _store()
    session = MoonrakerSession(rng=ZeroRng())
    session.running = True
    session.transport = "connected"
    controller = Controller(session, store, {"moonrakerUrl": "http://localhost:7125", "displayName": "Trident"})
    log: list[dict] = []
    return controller, log, (lambda action: log.append(action))


def _sent(log: list[dict]) -> list[dict]:
    return [json.loads(item["text"]) for item in log if item.get("kind") == "send"]


def _reply(controller, log, io, result="ok"):
    rpc = _sent(log)[-1]
    controller.on_message(json.dumps({"jsonrpc": "2.0", "id": rpc["id"], "result": result}), io)
    return rpc


def test_control_methods_are_opt_in_and_host_power_stays_blocked():
    encoded = json.loads(encode_request(3, "printer.gcode.script", {"script": "G28"}, control=True))
    assert encoded["method"] == "printer.gcode.script"
    assert encoded["params"]["script"] == "G28"
    with pytest.raises(MethodNotAllowedError):
        encode_request(3, "printer.gcode.script", {"script": "G28"})
    for method in ("machine.shutdown", "machine.reboot", "server.restart", "server.files.write", "server.config.write"):
        with pytest.raises(MethodNotAllowedError):
            encode_request(3, method, {}, control=True)
    plan = plan_subscription(
        ["led case", "output_pin case_light", "output_pin heater_enable", "heater_fan hotend", "fan_generic nevermore", "mmu"]
    )
    assert plan["objects"]["led case"] == ["color_data"]
    assert plan["objects"]["output_pin case_light"] == ["value"]
    assert "output_pin heater_enable" not in plan["objects"]
    assert "mmu" not in plan["objects"]


def test_jog_waits_for_the_reply_and_rejects_a_second_tap():
    controller, log, io = _controller()
    controller.jog("x", 10, 50, io)
    assert controller.toast is None
    sent = _sent(log)
    assert len(sent) == 1
    assert sent[0]["method"] == "printer.gcode.script"
    assert sent[0]["params"]["script"] == "SAVE_GCODE_STATE NAME=layr_jog\nG91\nG1 X10 F3000\nRESTORE_GCODE_STATE NAME=layr_jog"
    controller.jog("y", 10, 50, io)
    assert _sent(log) == sent
    assert controller.toast["text"] == "Still waiting for the previous command"
    assert "motion" in controller.gateway.inflight
    _reply(controller, log, io)
    assert controller.toast["tone"] == "ok"
    assert controller.toast["text"].startswith("Move X +10 mm")
    assert "motion" in controller.gateway.inflight
    controller.on_message(
        json.dumps({"jsonrpc": "2.0", "method": "notify_status_update", "params": [{"toolhead": {"position": [20, 20, 5, 0]}}]}),
        io,
    )
    assert "motion" not in controller.gateway.inflight


def test_disconnected_and_unhomed_and_limits_send_nothing():
    offline, log, io = _controller()
    offline.store.transport = "waiting"
    offline.store.klippy = "unknown"
    offline.jog("x", 10, 50, io)
    assert _sent(log) == []
    assert offline.toast["text"] == "Printer is offline"
    assert not offline.gateway.inflight

    cold, log, io = _controller(_store(homed=""))
    cold.jog("x", 10, 50, io)
    assert _sent(log) == []
    assert cold.toast["text"] == "Home X first"

    floor, log, io = _controller()
    floor.store.raw["toolhead"]["position"] = [10, 20, 0, 0]
    floor.jog("z", -1, 10, io)
    assert _sent(log) == []
    assert "safe minimum" in floor.toast["text"]

    huge, log, io = _controller()
    huge.jog("x", 150, 50, io)
    assert _sent(log) == []
    assert "100 mm" in huge.toast["text"]

    printing, log, io = _controller(_store(printing=True))
    printing.jog("z", 1, 10, io)
    assert _sent(log) == []
    assert printing.toast["text"] == "Not available during a print"
    printing.baby_step(0.05, io)
    assert _sent(log)[-1]["params"]["script"] == "SET_GCODE_OFFSET Z_ADJUST=0.05 MOVE=1"


def test_home_extrude_heat_fans_and_files_use_exact_requests():
    controller, log, io = _controller()
    controller.home("all", io)
    assert _sent(log)[-1]["params"]["script"] == "G28"
    assert [item["ms"] for item in log if item.get("kind") == "timer" and str(item["name"]).startswith("cmd")][-1] == 180_000
    _reply(controller, log, io)
    controller.on_timer("settle", io)

    z_only, log, io = _controller(_store(homed="z"))
    z_only.home("z", io)
    assert _sent(log) == []
    assert z_only.toast["text"] == "Home X and Y first, or use Home all"
    ready_xy, log, io = _controller(_store(homed="xy"))
    ready_xy.home("z", io)
    assert _sent(log)[-1]["params"]["script"] == "G28 Z"

    heat, log, io = _controller()
    heat.set_heater("extruder", 215, io)
    assert heat.toast is None
    assert _sent(log)[-1]["params"]["script"] == "SET_HEATER_TEMPERATURE HEATER=extruder TARGET=215"
    _reply(heat, log, io)

    high, log, io = _controller()
    high.set_heater("extruder", 270, io)
    assert _sent(log) == []
    assert high.confirm["title"] == "Heat Nozzle to 270 °C?"
    high.confirm_pending(io)
    assert _sent(log)[-1]["params"]["script"] == "SET_HEATER_TEMPERATURE HEATER=extruder TARGET=270"

    over, log, io = _controller()
    over.set_heater("extruder", 400, io)
    assert _sent(log) == []
    assert "300" in over.toast["text"]
    assert over.confirm is None

    cold, log, io = _controller(_store(temp=40, can=False))
    cold.extrude(10, 5, io)
    assert _sent(log) == []
    assert "below 170" in cold.toast["text"]
    hot, log, io = _controller()
    hot.extrude(10, 5, io)
    assert _sent(log)[-1]["params"]["script"] == "SAVE_GCODE_STATE NAME=layr_extrude\nM83\nG1 E10 F300\nRESTORE_GCODE_STATE NAME=layr_extrude"
    hot.extrude(-5, 5, io)
    assert hot.toast["text"] == "Still waiting for the previous command"
    assert len(_sent(log)) == 1

    fan, log, io = _controller()
    fan.set_fan("heater_fan hotend_fan", 1, io)
    fan.set_fan("controller_fan board", 1, io)
    assert _sent(log) == []
    assert "automatically" in fan.toast["text"]
    fan.set_fan("fan", 0.5, io)
    assert _sent(log)[-1]["params"]["script"] == "M106 S128"
    _reply(fan, log, io)
    fan.set_fan("fan", 0, io)
    assert _sent(log)[-1]["params"]["script"] == "M107"
    _reply(fan, log, io)
    fan.set_fan("fan_generic nevermore", 0.5, io)
    assert _sent(log)[-1]["params"]["script"] == "SET_FAN_SPEED FAN=nevermore SPEED=0.5"

    files, log, io = _controller()
    for path in ("../printer.cfg", "/etc/passwd", "gcodes/../../printer.cfg", "a/../b.gcode", "a\\b.gcode"):
        files.delete_file(path, io)
        files.start_print(path, io)
        assert _sent(log) == []
    files.delete_file("jobs/a.gcode", io)
    assert files.confirm["confirmLabel"] == "Delete"
    assert _sent(log) == []
    files.confirm_pending(io)
    deleted = _sent(log)[-1]
    assert deleted["method"] == "server.files.delete_file"
    assert deleted["params"] == {"path": "gcodes/jobs/a.gcode"}

    active, log, io = _controller(_store(printing=True))
    active.delete_file("jobs/part.gcode", io)
    active.start_print("jobs/part.gcode", io)
    active.start_print("jobs/other.gcode", io)
    assert _sent(log) == []
    assert "being printed" in active.toast["text"] or "active print" in active.toast["text"] or "already" in active.toast["text"]


def test_console_macros_estop_and_disconnect_do_not_claim_success():
    controller, log, io = _controller()
    controller.console_send("G28 X0", io)
    assert _sent(log) == []
    assert controller.confirm["title"] == "Send this command?"
    controller.confirm_pending(io)
    assert _sent(log)[-1]["params"]["script"] == "G28 X0"
    _reply(controller, log, io)

    blank, log, io = _controller()
    blank.console_send("\n", io)
    blank.console_send("M104 S200\nM140 S60", io)
    assert _sent(log) == []

    estop, log, io = _controller()
    estop.console_send("M112", io)
    assert estop.confirm is None
    assert _sent(log)[-1]["method"] == "printer.emergency_stop"
    assert "params" not in _sent(log)[-1]

    macro, log, io = _controller()
    macro.run_macro("PRINT_START", io)
    assert _sent(log) == []
    macro.confirm_pending(io)
    assert _sent(log)[-1]["params"]["script"] == "PRINT_START"
    missing, log, io = _controller()
    missing.run_macro("NOT_A_MACRO", io)
    missing.run_macro("NEEDS_TEMP", io)
    assert _sent(log) == []
    assert "not available" in missing.toast["text"] or "TEMP" in missing.toast["text"]

    busy, log, io = _controller()
    busy.home("xy", io)
    assert _sent(log)[-1]["params"]["script"] == "G28 X Y"
    busy.emergency_stop(io)
    assert _sent(log)[-1]["method"] == "printer.emergency_stop"

    lost, log, io = _controller()
    lost.jog("x", 10, 50, io)
    lost.on_close("Connection closed", io)
    assert lost.toast["tone"] == "warn"
    assert "before Moonraker replied" in lost.toast["text"]
    assert "motion" not in lost.gateway.inflight
    assert lost.toast["tone"] != "ok"

    rejected, log, io = _controller()
    rejected.jog("y", 1, 50, io)
    rpc = _sent(log)[-1]
    rejected.on_message(
        json.dumps({"jsonrpc": "2.0", "id": rpc["id"], "error": {"message": "!! Must home axis first: 0.000 0.000 0.000 [0.000]"}}),
        io,
    )
    assert rejected.toast["tone"] == "danger"
    assert "Must home axis first" in rejected.toast["text"]
    assert "motion" not in rejected.gateway.inflight


def test_fixture_and_shutdown_estop_rules():
    controller, log, io = _controller()
    controller.fixture = True
    controller.jog("x", 10, 50, io)
    controller.emergency_stop(io)
    controller.set_heater("extruder", 200, io)
    assert _sent(log) == []
    assert "Fixture mode" in controller.toast["text"]

    down, log, io = _controller()
    down.store.klippy = "shutdown"
    down.jog("x", 10, 50, io)
    assert _sent(log) == []
    assert "error state" in down.toast["text"]
    down.emergency_stop(io)
    assert _sent(log)[-1]["method"] == "printer.emergency_stop"

    prepared = prepare_command({"kind": "pause"}, down.snapshot())
    assert prepared["ok"] is False


def test_pause_cancel_and_restart_need_the_right_state():
    idle, log, io = _controller()
    idle.pause(io)
    idle.cancel(io)
    assert _sent(log) == []
    running, log, io = _controller(_store(printing=True))
    running.pause(io)
    assert _sent(log)[-1]["method"] == "printer.print.pause"
    assert running.toast is None
    _reply(running, log, io)
    running.cancel(io)
    assert running.confirm["confirmLabel"] == "Cancel print"
    assert len(_sent(log)) == 1
    running.cancel(io)
    assert running.toast["text"] == "Answer the confirmation first"
    assert len(_sent(log)) == 1
    running.confirm_pending(io)
    assert _sent(log)[-1]["method"] == "printer.print.cancel"

    restart, log, io = _controller()
    restart.restart_klipper(io)
    assert _sent(log) == []
    restart.confirm_pending(io)
    assert _sent(log)[-1]["method"] == "printer.restart"
    _reply(restart, log, io)
    restart.firmware_restart(io)
    restart.confirm_pending(io)
    assert _sent(log)[-1]["method"] == "printer.firmware_restart"
