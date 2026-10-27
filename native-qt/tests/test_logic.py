"""Unit tests for the read-only Moonraker model. No Qt and no network."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from layr_qt.controller import Controller
from layr_qt.moonraker.adapters import (
    SpoolmanNotReady,
    mmu_object_names,
    prototype_cannot_call_spoolman_or_mmu,
    spoolman_list_request,
    spoolman_set_active_request,
)
from layr_qt.moonraker.backoff import Backoff, BackoffOptions
from layr_qt.moonraker.files import image_kind, map_thumbnails, safe_relative, thumbnail_request_url
from layr_qt.moonraker.protocol import MethodNotAllowedError, encode_request, merge_status, plan_subscription
from layr_qt.moonraker.session import MoonrakerSession
from layr_qt.moonraker.status import estimate_remaining, format_duration, format_flow
from layr_qt.moonraker.telemetry import (
    filament_cross_section_area_mm2,
    filament_diameter_mm,
    map_motion,
    quantize_flow_mm3_s,
    quantize_speed_mm_s,
    volumetric_flow_mm3_per_s,
)
from layr_qt.moonraker.urls import validate_moonraker_url, websocket_url
from layr_qt.perf import PerfTracker, cpu_percent, proc_ticks, read_rss_kib
from layr_qt.preferences import load_preferences, resolve_printer_name, save_preferences
from layr_qt.store import PrinterStore
from layr_qt.viewmodel import build_view

ROOT = Path(__file__).resolve().parents[1]


class ZeroRng:
    def random(self) -> float:
        return 0.0


def settings(diameter, section="extruder"):
    return {section: {"filament_diameter": diameter}}


def test_flow_math_matches_the_svelte_definition():
    area = filament_cross_section_area_mm2(1.75)
    assert area == pytest.approx(math.pi * 0.875 * 0.875)
    assert volumetric_flow_mm3_per_s(5, 1.75) == pytest.approx(5 * area)
    assert volumetric_flow_mm3_per_s(-4, 1.75) == pytest.approx(-4 * area)
    assert volumetric_flow_mm3_per_s(0, 2.85) == 0
    assert quantize_speed_mm_s(48.2) == 48
    assert quantize_speed_mm_s(48.4) == 48
    assert quantize_flow_mm3_s(12.026) == 12
    assert quantize_flow_mm3_s(12.049) == 12
    assert quantize_flow_mm3_s(-0.04) == 0


def test_map_motion_ignores_speed_and_extrude_factors():
    reading = map_motion(
        {
            "motion_report": {"live_velocity": 48.2, "live_extruder_velocity": 5},
            "toolhead": {"extruder": "extruder"},
            "gcode_move": {"speed_factor": 1.5, "extrude_factor": 0.8},
        },
        settings("1.75"),
    )
    assert reading["speedMmS"] == 48
    assert reading["flowMm3S"] == quantize_flow_mm3_s(volumetric_flow_mm3_per_s(5, 1.75))
    assert reading["flowGap"] is None
    assert reading["speedMmS"] != 150
    assert "%" not in str(reading["flowMm3S"])

    missing = map_motion({"gcode_move": {"speed_factor": 2, "extrude_factor": 1.25}, "toolhead": {"max_velocity": 300}}, settings("1.75"))
    assert missing["speedMmS"] is None
    assert missing["flowMm3S"] is None
    assert missing["flowGap"] == "velocity"


def test_active_extruder_diameter_retraction_and_gaps():
    reading = map_motion(
        {"motion_report": {"live_velocity": 20, "live_extruder_velocity": 1}, "toolhead": {"extruder": "extruder1"}},
        {"extruder": {"filament_diameter": "1.75"}, "extruder1": {"filament_diameter": "2.85"}},
    )
    assert reading["filamentDiameterMm"] == 2.85
    assert reading["flowMm3S"] == quantize_flow_mm3_s(volumetric_flow_mm3_per_s(1, 2.85))

    stopped = map_motion({"motion_report": {"live_velocity": 0, "live_extruder_velocity": 0}}, settings("1.75"))
    assert stopped["speedMmS"] == 0 and stopped["flowMm3S"] == 0

    retract = map_motion({"motion_report": {"live_velocity": 30, "live_extruder_velocity": -4}}, settings("1.75"))
    assert retract["speedMmS"] == 30
    assert retract["flowMm3S"] < 0

    no_diameter = map_motion({"motion_report": {"live_velocity": 10, "live_extruder_velocity": 2}}, {})
    assert no_diameter["flowGap"] == "diameter" and no_diameter["flowMm3S"] is None
    for diameter in ("0", "nope", "  ", 0, -1, 12):
        assert filament_diameter_mm(settings(diameter), "extruder") is None
    assert filament_diameter_mm(settings(" 1.75 "), "extruder") == 1.75
    assert map_motion({}, settings("1.75"))["flowGap"] == "velocity"
    assert map_motion({"motion_report": {"live_velocity": -5, "live_extruder_velocity": 0}}, settings("1.75"))["speedMmS"] == 0


def test_urls_reject_secrets_and_build_a_local_socket():
    assert validate_moonraker_url("http://localhost:7125") == "http://localhost:7125"
    assert validate_moonraker_url("ws://printer.local:7125") == "http://printer.local:7125"
    assert validate_moonraker_url("http://user:secret@localhost:7125") is None
    assert validate_moonraker_url("http://localhost:7125/printer") is None
    assert websocket_url("http://localhost:7125") == "ws://localhost:7125/websocket"
    token_url = websocket_url("http://localhost:7125", "one shot")
    assert token_url is None
    assert websocket_url("http://localhost:7125", "abc") == "ws://localhost:7125/websocket?token=abc"


def test_thumbnail_urls_stay_inside_gcodes():
    base = "http://localhost:7125"
    assert thumbnail_request_url(base, "parts/.thumbs/cube-300x300.png") == (
        "http://localhost:7125/server/files/gcodes/parts/.thumbs/cube-300x300.png"
    )
    assert thumbnail_request_url(base, "../etc/passwd.png") is None
    assert thumbnail_request_url(base, "http://evil.test/a.png") is None
    assert thumbnail_request_url(base, "shots/.thumbs/../../secret.png") == (
        "http://localhost:7125/server/files/gcodes/secret.png"
    )
    assert thumbnail_request_url(base, "/etc/passwd.png") is None
    assert safe_relative("folder/../cube.gcode") == "cube.gcode"
    thumbs = map_thumbnails(
        "jobs/part.gcode",
        [{"relative_path": ".thumbs/part-32x32.png", "width": 32, "height": 32}, {"relative_path": "http://evil/a.png"}],
    )
    assert [item["path"] for item in thumbs] == ["jobs/.thumbs/part-32x32.png"]
    assert image_kind(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8) == "png"
    assert image_kind(b"<html>nope</html>") is None
    assert image_kind(b"\xff\xd8\xff" + b"\x00" * 16) == "jpeg"


def test_subscription_includes_motion_and_skips_mmu():
    names = [f"temperature_sensor sensor{i}" for i in range(9)] + [
        "temperature_sensor chamber",
        "extruder",
        "heater_bed",
        "print_stats",
        "motion_report",
        "configfile",
        "mmu",
        "AFC",
        "fan",
    ]
    plan = plan_subscription(names)
    assert plan["objects"]["motion_report"] == ["live_velocity", "live_extruder_velocity"]
    assert "mmu" not in plan["objects"]
    assert "AFC" not in plan["objects"]
    assert "temperature_sensor chamber" in plan["objects"]
    assert mmu_object_names(names) == ["mmu", "AFC"]
    assert prototype_cannot_call_spoolman_or_mmu()
    with pytest.raises(MethodNotAllowedError):
        encode_request(1, "printer.gcode.script", {"script": "G28"})
    with pytest.raises(MethodNotAllowedError):
        encode_request(1, "server.spoolman.post_spool_id", {"spool_id": 1})
    assert spoolman_list_request()["method"] not in plan["objects"]
    blocked = SpoolmanNotReady()
    with pytest.raises(NotImplementedError):
        blocked.list_spools("default")
    blocked.clear_active_spool_after_unload("default", "cancelled")
    with pytest.raises(NotImplementedError):
        blocked.clear_active_spool_after_unload("default", "confirmed-success")
    assert spoolman_set_active_request(None)["params"]["spool_id"] is None


def test_merge_and_estimates():
    target = {"print_stats": {"info": {"current_layer": 1}, "state": "printing"}}
    merge_status(target, {"print_stats": {"info": {"total_layer": 4}, "filename": "a.gcode"}})
    assert target["print_stats"]["info"]["current_layer"] == 1
    assert target["print_stats"]["info"]["total_layer"] == 4
    assert target["print_stats"]["filename"] == "a.gcode"
    early = estimate_remaining(0.01, 10, 1000)
    assert early["source"] == "slicer"
    later = estimate_remaining(0.5, 100, 1000)
    assert later["source"] == "progress"
    assert later["remaining"] == pytest.approx(100)
    assert format_duration(3670) == "1h 01m"
    assert format_duration(90) == "1m 30s"
    assert format_flow(-12.03) == "-12.0"


def test_backoff_grows_and_resets():
    backoff = Backoff(rng=ZeroRng())
    assert backoff.next_ms() == 1000
    assert backoff.next_ms() == 2000
    assert backoff.next_ms() == 4000
    backoff.reset()
    assert backoff.next_ms() == 1000
    with pytest.raises(ValueError):
        Backoff(BackoffOptions(initial_ms=0))


def _rpc(actions):
    sends = [item for item in actions if item["kind"] == "send"]
    assert len(sends) == 1, actions
    return json.loads(sends[0]["text"])


def _ok(rpc_id, result):
    return json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": result})


PRINTING_STATUS = {
    "extruder": {"temperature": 210.2, "target": 215, "power": 0.4, "can_extrude": True},
    "heater_bed": {"temperature": 60.2, "target": 60, "power": 0.2},
    "print_stats": {
        "filename": "jobs/voron_cube.gcode",
        "state": "printing",
        "print_duration": 100,
        "total_duration": 120,
        "filament_used": 1500,
        "info": {"current_layer": 2, "total_layer": 10},
    },
    "display_status": {"progress": 0.2},
    "motion_report": {"live_velocity": 48.2, "live_extruder_velocity": 5},
    "toolhead": {"extruder": "extruder", "homed_axes": "xyz", "position": [10, 20, 0.4, 0]},
    "gcode_move": {"speed_factor": 1.5, "extrude_factor": 0.8},
    "configfile": {"settings": {"extruder": {"filament_diameter": "1.75"}}},
    "temperature_sensor chamber": {"temperature": 35.2},
    "fan": {"speed": 0.8},
}


def test_session_subscribes_and_view_uses_live_motion(tmp_path):
    io_log = []

    def io(action):
        io_log.append(action)

    session = MoonrakerSession(rng=ZeroRng())
    store = PrinterStore()
    controller = Controller(session, store, {"displayName": "Trident", "moonrakerUrl": "http://localhost:7125"})
    controller.start(io)
    assert io_log[-1]["kind"] == "connect"
    controller.on_open(io)
    identify = _rpc(io_log[-1:])
    assert identify["method"] == "server.connection.identify"
    controller.on_message(_ok(identify["id"], {"connection_id": 1}), io)
    info = _rpc([item for item in io_log if item["kind"] == "send"][-1:])
    controller.on_message(_ok(info["id"], {"klippy_connected": True, "klippy_state": "ready"}), io)
    printer = _rpc([item for item in io_log if item["kind"] == "send"][-1:])
    controller.on_message(_ok(printer["id"], {"hostname": "mainsailos", "state": "ready", "state_message": ""}), io)
    listing = _rpc([item for item in io_log if item["kind"] == "send"][-1:])
    objects = [
        "webhooks",
        "print_stats",
        "display_status",
        "virtual_sdcard",
        "extruder",
        "heater_bed",
        "toolhead",
        "gcode_move",
        "idle_timeout",
        "motion_report",
        "configfile",
        "fan",
        "temperature_sensor chamber",
        "mmu",
        "AFC",
    ]
    controller.on_message(_ok(listing["id"], {"objects": objects}), io)
    subscribe = _rpc([item for item in io_log if item["kind"] == "send"][-1:])
    assert subscribe["method"] == "printer.objects.subscribe"
    assert "mmu" not in subscribe["params"]["objects"]
    assert subscribe["params"]["objects"]["motion_report"] == ["live_velocity", "live_extruder_velocity"]
    controller.on_message(_ok(subscribe["id"], {"status": PRINTING_STATUS}), io)
    meta = _rpc([item for item in io_log if item["kind"] == "send"][-1:])
    assert meta["method"] == "server.files.metadata"
    assert meta["params"]["filename"] == "jobs/voron_cube.gcode"
    controller.on_message(
        _ok(
            meta["id"],
            {
                "estimated_time": 5000,
                "thumbnails": [{"relative_path": ".thumbs/voron_cube-300x300.png", "width": 300, "height": 300}],
            },
        ),
        io,
    )
    view = build_view(store, controller.prefs, now_ms=1_700_000_000_000, perf={"startupMs": None}, page="home", utc=True)
    assert view["printerName"] == "Trident"
    assert view["hostname"] == "mainsailos"
    assert "mainsailos" not in view["printerName"]
    assert view["motion"]["speedText"] == "48"
    assert view["motion"]["flowText"] == format_flow(quantize_flow_mm3_s(volumetric_flow_mm3_per_s(5, 1.75)))
    assert view["overrides"]["speed"] == "150%"
    assert "mm" not in view["overrides"]["speed"]
    assert view["overrides"]["flow"] == "80%"
    assert view["job"]["thumbnailKey"] == "jobs/.thumbs/voron_cube-300x300.png"
    assert view["job"]["displayName"] == "voron_cube"
    assert view["temps"][0]["value"] == "210"
    assert view["temps"][2]["value"] == "35"
    assert view["fans"][0]["text"] == "80%"
    assert "apiKey" not in json.dumps(view)

    controller.on_message(
        json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "notify_status_update",
                "params": [{"motion_report": {"live_extruder_velocity": -4}}],
            }
        ),
        io,
    )
    retracting = build_view(store, controller.prefs, now_ms=1_700_000_000_000, perf={}, page="home", utc=True)
    assert retracting["motion"]["retracting"] is True
    assert retracting["motion"]["flowText"].startswith("-")
    assert retracting["motion"]["speedText"] == "48"

    controller.on_close("Connection closed", io)
    offline = build_view(store, controller.prefs, now_ms=1_700_000_000_000, perf={}, page="home", utc=True)
    assert offline["status"] == "disconnected"
    assert offline["motion"]["speedText"] == "—"
    assert offline["motion"]["flowText"] == "—"
    assert offline["temps"][0]["value"] == "—"
    assert offline["job"]["visible"] is False
    assert offline["printerName"] == "Trident"
    timers = [item for item in io_log if item["kind"] == "timer" and item["name"] == "reconnect"]
    assert timers[-1]["ms"] == 1000

    path = tmp_path / "preferences.json"
    save_preferences(path, controller.prefs)
    loaded = load_preferences(path)
    assert loaded["displayName"] == "Trident"
    assert loaded["moonrakerUrl"] == "http://localhost:7125"
    assert "apiKey" not in path.read_text(encoding="utf-8")
    assert resolve_printer_name("", "voron") == ("voron", "hostname")
    assert resolve_printer_name("", None) == ("Klipper printer", "fallback")


def test_preferences_reject_bad_urls_and_keep_the_os_name_alone(tmp_path):
    path = tmp_path / "preferences.json"
    save_preferences(path, {"moonrakerUrl": "http://user:pw@localhost:7125", "displayName": "bad\nname"})
    loaded = load_preferences(path)
    assert loaded["moonrakerUrl"] == "http://localhost:7125"
    assert loaded["displayName"] == "badname"
    assert load_preferences(tmp_path / "missing.json")["hideCursor"] is True


def test_perf_parser_and_touch_sample():
    rss = read_rss_kib("Name:\tpython\nVmRSS:\t   12345 kB\n")
    assert rss == 12345
    stat = "123 (python two) S 1 1 1 1 1 1 1 1 1 1 10 15"
    assert proc_ticks(stat) == 25
    assert cpu_percent(100, 1, 100) == pytest.approx(100)
    tracker = PerfTracker(started_monotonic=10)
    tracker.note_frame(10.2)
    assert tracker.snapshot()["startupMs"] == 200
    tracker.note_press(11)
    tracker.note_frame(11.018)
    assert tracker.snapshot()["touchMs"] == pytest.approx(18, abs=0.2)
    tracker.note_proc("VmRSS:\t2048 kB\n", stat, 12, 100)
    tracker.note_proc("VmRSS:\t4096 kB\n", "123 (python) S 1 1 1 1 1 1 1 1 1 1 20 25", 13, 100)
    snap = tracker.snapshot()
    assert snap["rssMb"] == 4.0
    assert snap["cpuPercent"] == pytest.approx(20)


def test_qml_does_not_present_factors_as_speed():
    home = (ROOT / "qml" / "HomePage.qml").read_text(encoding="utf-8")
    controls = (ROOT / "qml" / "ControlsPage.qml").read_text(encoding="utf-8")
    assert "speedFactor" not in home
    assert "extrudeFactor" not in home
    assert "mm/s" in home
    assert "mm³/s" in home
    assert "M220" in controls
    assert "M221" in controls
    assert "printer.gcode" not in home
    assert "printer.gcode" not in controls


def test_scripts_do_not_stop_the_display_stack():
    scripts = ROOT / "scripts"
    for name in ("install.sh", "rollback.sh", "launch-session.sh", "check-deps.sh", "bench-sample.sh"):
        text = (scripts / name).read_text(encoding="utf-8")
        assert "apt-get install" not in text
        assert "apt install" not in text
        for forbidden in ("systemctl stop", "systemctl disable", "systemctl restart", "printer.cfg", "moonraker.conf"):
            assert forbidden not in text
    launch = (scripts / "launch-session.sh").read_text(encoding="utf-8")
    assert "eglfs" in launch
    assert "layr-kiosk" in launch
    install = (scripts / "install.sh").read_text(encoding="utf-8")
    assert "--yes" in install
