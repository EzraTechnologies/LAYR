"""Spoolman reads, confirmation, and unload rules. No network and no printer."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from layr_qt.controller import Controller
from layr_qt.moonraker.protocol import MethodNotAllowedError, encode_request
from layr_qt.moonraker.session import MoonrakerSession
from layr_qt.spoolman.api import ingest_proxy, spoolman_list_request, spoolman_proxy_allowed, spoolman_write_allowed
from layr_qt.spoolman.samples import fixture_payload, solid_png
from layr_qt.store import PrinterStore
from layr_qt.viewmodel import build_view

from test_logic import ZeroRng

ROOT = Path(__file__).resolve().parents[1]


def _ok(rpc_id, result):
    return json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": result})


def _err(rpc_id, message):
    return json.dumps({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32601, "message": message}})


def _log():
    found = []

    def io(action):
        found.append(action)

    return found, io


def _sends(io_log):
    return [json.loads(item["text"]) for item in io_log if item.get("kind") == "send"]


def _last(io_log, method):
    found = [item for item in _sends(io_log) if item["method"] == method]
    assert found, method
    return found[-1]


def _spool(spool_id, name="PolyTerra", material="PLA", vendor="Polymaker", **extra):
    filament = {"id": spool_id, "name": name, "material": material, "vendor": {"name": vendor}, "color_hex": "3366CC", "weight": 1000}
    filament.update(extra.pop("filament", {}))
    body = {
        "id": spool_id,
        "filament": filament,
        "remaining_weight": 800,
        "used_weight": 200,
        "archived": False,
    }
    body.update(extra)
    return body


def _ready(controller, io_log, send, objects=None):
    controller.start(send)
    controller.on_open(send)
    identify = _sends(io_log)[-1]
    controller.on_message(_ok(identify["id"], {"connection_id": 1}), send)
    info = _last(io_log, "server.info")
    controller.on_message(_ok(info["id"], {"klippy_connected": True, "klippy_state": "ready"}), send)
    printer = _last(io_log, "printer.info")
    controller.on_message(_ok(printer["id"], {"hostname": "mainsailos", "state": "ready", "state_message": ""}), send)
    listing = _last(io_log, "printer.objects.list")
    controller.on_message(_ok(listing["id"], {"objects": objects or ["webhooks", "print_stats", "toolhead", "extruder", "gcode_macro CUSTOM_UNLOAD"]}), send)
    subscribe = _last(io_log, "printer.objects.subscribe")
    controller.on_message(
        _ok(
            subscribe["id"],
            {
                "status": {
                    "print_stats": {"filename": "", "state": "standby"},
                    "toolhead": {"homed_axes": "xyz", "position": [0, 0, 0, 0], "extruder": "extruder"},
                    "extruder": {"temperature": 25, "target": 0, "can_extrude": False},
                }
            },
        ),
        send,
    )


def _answer_catalog(controller, io_log, send, rows, spool_id=4, connected=True):
    status = _last(io_log, "server.spoolman.status")
    controller.on_message(
        _ok(status["id"], {"spoolman_connected": connected, "pending_reports": [], "spool_id": spool_id}),
        send,
    )
    if connected:
        listed = _last(io_log, "server.spoolman.proxy")
        controller.on_message(_ok(listed["id"], {"response": rows, "error": None}), send)
    active = _last(io_log, "server.spoolman.get_spool_id")
    controller.on_message(_ok(active["id"], {"spool_id": spool_id}), send)


def _view(controller):
    return build_view(
        controller.store,
        controller.prefs,
        now_ms=1_700_000_000_000,
        perf={},
        page="filament",
        utc=True,
        ui=controller.ui_state(),
        spoolman=controller.spoolman,
    )


def test_proxy_paths_and_writes_are_narrow():
    assert spoolman_proxy_allowed(spoolman_list_request(0)["params"])
    assert spoolman_proxy_allowed(spoolman_list_request(100)["params"])
    with pytest.raises(ValueError):
        spoolman_list_request(50)
    with pytest.raises(ValueError):
        spoolman_list_request(-100)
    blocked = [
        {"use_v2_response": True, "request_method": "POST", "path": "/v1/spool"},
        {"use_v2_response": True, "request_method": "GET", "path": "/v1/spool/../../secret"},
        {"use_v2_response": True, "request_method": "GET", "path": "/v1/spool/1/use"},
        {"use_v2_response": True, "request_method": "GET", "path": "/v1/filament"},
        {"use_v2_response": True, "request_method": "GET", "path": "/v1/spool", "query": "allow_archived=true&url=http://evil"},
        {"use_v2_response": False, "request_method": "GET", "path": "/v1/spool", "query": "allow_archived=true&limit=100&offset=0"},
    ]
    for params in blocked:
        assert spoolman_proxy_allowed(params) is False
        with pytest.raises(MethodNotAllowedError):
            encode_request(1, "server.spoolman.proxy", params)
    assert spoolman_write_allowed({"spool_id": None})
    assert spoolman_write_allowed({"spool_id": True}) is False
    assert spoolman_write_allowed({"spool_id": 0}) is False
    with pytest.raises(MethodNotAllowedError):
        encode_request(1, "server.spoolman.post_spool_id", {"spool_id": None})
    sent = json.loads(encode_request(4, "server.spoolman.post_spool_id", {"spool_id": None}, control=True))
    assert sent["params"]["spool_id"] is None


def test_images_stay_inside_the_json_payload():
    png = solid_png(8, 8, (10, 20, 30))
    import base64

    payload = [
        _spool(1, filament={"extra": {"photo": "data:image/png;base64," + base64.b64encode(png).decode()}}),
        _spool(2, filament={"extra": {"image": "https://example.invalid/spool.jpg"}}),
        _spool(3, filament={"extra": {"picture": "javascript:alert(1)"}}),
        {"id": 4, "filament": {"id": 4}, "archived": False},
    ]
    ingested = ingest_proxy({"response": payload, "error": None})
    by_id = {item["id"]: item for item in ingested["spools"]}
    assert by_id[1]["imageKey"] == "spool/1"
    assert ingested["images"]["spool/1"].startswith(b"\x89PNG")
    assert by_id[2]["imageKey"] == ""
    assert by_id[3]["imageKey"] == ""
    assert ingested["rejected"] >= 2
    assert by_id[4]["name"] == "Spool 4"
    assert by_id[4]["vendor"] == ""
    assert by_id[4]["remaining"] is None
    blob = json.dumps(by_id)
    assert "example.invalid" not in blob
    assert "base64" not in blob
    assert "https://" not in blob
    fixture = ingest_proxy({"response": fixture_payload(), "error": None})
    assert fixture["images"]
    assert "example.invalid" not in json.dumps(fixture["spools"])


def test_list_pages_and_the_view_stays_one_page():
    io, send = _log()
    controller = Controller(MoonrakerSession(rng=ZeroRng()), PrinterStore(), {"displayName": "Trident", "moonrakerUrl": "http://localhost:7125"})
    _ready(controller, io, send)
    first = [_spool(index, name=f"Spool {index}", material="ASA" if index % 2 == 0 else "PLA") for index in range(1, 101)]
    status = _last(io, "server.spoolman.status")
    controller.on_message(_ok(status["id"], {"spoolman_connected": True, "spool_id": 1}), send)
    listed = _last(io, "server.spoolman.proxy")
    assert listed["params"]["query"].endswith("offset=0")
    controller.on_message(_ok(listed["id"], {"response": first, "error": None}), send)
    nxt = _last(io, "server.spoolman.proxy")
    assert "offset=100" in nxt["params"]["query"]
    second = [_spool(index, name=f"Spool {index}") for index in range(101, 121)]
    controller.on_message(_ok(nxt["id"], {"response": second, "error": None}), send)
    assert not any("offset=200" in item["params"].get("query", "") for item in _sends(io) if item["method"] == "server.spoolman.proxy")
    active = _last(io, "server.spoolman.get_spool_id")
    controller.on_message(_ok(active["id"], {"spool_id": 1}), send)
    view = _view(controller)
    assert view["spoolman"]["count"] == 120
    assert len(view["spoolman"]["rows"]) == 40
    assert view["spoolman"]["pages"] == 3
    controller.move_spool_page(1)
    moved = _view(controller)
    assert moved["spoolman"]["rows"][0]["id"] == 41
    controller.set_spool_filter("", "ASA", "", "all", "")
    filtered = _view(controller)
    assert filtered["spoolman"]["matched"] == 50
    assert all(row["material"] == "ASA" for row in filtered["spoolman"]["rows"])
    assert filtered["spoolman"]["printerKey"] == "http://localhost:7125"
    rows_blob = json.dumps(filtered["spoolman"]["rows"])
    assert "http://" not in rows_blob
    assert "https://" not in rows_blob


def test_active_spool_states_absent_and_offline():
    io, send = _log()
    controller = Controller(MoonrakerSession(rng=ZeroRng()), PrinterStore(), {"displayName": "Trident", "moonrakerUrl": "http://localhost:7125"})
    _ready(controller, io, send)
    status = _last(io, "server.spoolman.status")
    controller.on_message(_err(status["id"], "Method not found"), send)
    missing = _view(controller)
    assert missing["spoolman"]["phase"] == "absent"
    assert missing["spoolman"]["rows"] == []
    assert "moonraker.conf" in missing["spoolman"]["help"]
    assert missing["spool"]["text"] == "Spoolman is not enabled"
    assert "g" not in missing["spool"]["text"]

    io2, send2 = _log()
    other = Controller(MoonrakerSession(rng=ZeroRng()), PrinterStore(), {"displayName": "Trident", "moonrakerUrl": "http://printer.local:7125"})
    _ready(other, io2, send2)
    _answer_catalog(other, io2, send2, [], spool_id=None, connected=False)
    offline = _view(other)
    assert offline["spoolman"]["phase"] == "offline"
    assert offline["spoolman"]["rows"] == []
    assert offline["spoolman"]["activeText"] == "No active spool"
    assert offline["spool"]["text"] == "Spoolman is offline"


def test_set_clear_and_unload_do_not_write_without_confirmation():
    io, send = _log()
    controller = Controller(MoonrakerSession(rng=ZeroRng()), PrinterStore(), {"displayName": "Trident", "moonrakerUrl": "http://localhost:7125"})
    _ready(controller, io, send)
    rows = [_spool(4, name="Charcoal"), _spool(5, name="Blue PETG", material="PETG"), {"id": 6, "filament": {"id": 6}, "archived": False}]
    _answer_catalog(controller, io, send, rows, spool_id=4)
    before = len(_sends(io))
    controller.select_spool(5)
    controller.set_active_spool(5, send)
    assert controller.confirm["title"].startswith("Set active spool")
    assert len(_sends(io)) == before
    controller.set_active_spool(5, send)
    assert "confirmation" in controller.toast["text"].lower() or "Answer" in controller.toast["text"]
    assert len(_sends(io)) == before
    controller.confirm_pending(send)
    posted = _last(io, "server.spoolman.post_spool_id")
    assert posted["params"] == {"spool_id": 5}
    assert len([item for item in _sends(io) if item["method"] == "server.spoolman.post_spool_id"]) == 1
    controller.set_active_spool(6, send)
    assert controller.toast["text"] == "Still waiting for the previous command"
    assert len([item for item in _sends(io) if item["method"] == "server.spoolman.post_spool_id"]) == 1
    controller.on_message(_ok(posted["id"], {"spool_id": 5}), send)
    assert controller.spoolman.active_id == 5
    follow = _last(io, "server.spoolman.get_spool_id")
    controller.on_message(_ok(follow["id"], {"spool_id": 5}), send)
    shown = _view(controller)
    assert shown["spoolman"]["activeId"] == 5
    plain = next(row for row in shown["spoolman"]["rows"] if row["id"] == 6)
    assert plain["name"] == "Spool 6"
    assert plain["weightLine"] == "Weight not reported"
    assert "example.invalid" not in json.dumps(shown)

    controller.clear_active_spool(send)
    assert controller.confirm["confirmLabel"] == "Clear active spool"
    controller.dismiss_pending()
    assert controller.confirm is None
    assert len([item for item in _sends(io) if item["method"] == "server.spoolman.post_spool_id"]) == 1

    controller.store.raw["print_stats"] = {"filename": "jobs/part.gcode", "state": "printing"}
    controller.select_spool(4)
    controller.set_active_spool(4, send)
    assert "print is active" in controller.toast["text"]
    assert controller.confirm is None
    controller.store.raw["print_stats"] = {"filename": "", "state": "standby"}


def test_unload_clears_only_after_klipper_accepts_it():
    io, send = _log()
    controller = Controller(MoonrakerSession(rng=ZeroRng()), PrinterStore(), {"displayName": "Trident", "moonrakerUrl": "http://localhost:7125"})
    _ready(controller, io, send)
    _answer_catalog(controller, io, send, [_spool(4, name="Charcoal")], spool_id=4)
    controller.run_macro("CUSTOM_UNLOAD", send)
    controller.confirm_pending(send)
    macro = _last(io, "printer.gcode.script")
    controller.on_message(_ok(macro["id"], {}), send)
    assert not any(item["method"] == "server.spoolman.post_spool_id" for item in _sends(io))
    assert controller.spoolman.active_id == 4

    controller.unload_and_clear("CUSTOM_UNLOAD", send)
    assert "cleared only if Klipper accepts" in controller.confirm["body"]
    controller.dismiss_pending()
    assert not any(item["method"] == "server.spoolman.post_spool_id" for item in _sends(io))

    controller.unload_and_clear("CUSTOM_UNLOAD", send)
    controller.confirm_pending(send)
    script = _last(io, "printer.gcode.script")
    assert script["params"]["script"] == "CUSTOM_UNLOAD"
    controller.on_message(_err(script["id"], "!! Move out of range"), send)
    assert controller.spoolman.active_id == 4
    assert "kept" in controller.toast["text"]
    assert not any(item["method"] == "server.spoolman.post_spool_id" for item in _sends(io))

    controller.unload_and_clear("CUSTOM_UNLOAD", send)
    controller.confirm_pending(send)
    script = _last(io, "printer.gcode.script")
    controller.on_timer(f"cmd{script['id']}", send)
    assert "could not confirm" in controller.toast["text"].lower()
    assert controller.spoolman.active_id == 4
    assert not any(item["method"] == "server.spoolman.post_spool_id" for item in _sends(io))

    controller.unload_and_clear("CUSTOM_UNLOAD", send)
    controller.confirm_pending(send)
    script = _last(io, "printer.gcode.script")
    controller.on_message(_ok(script["id"], {}), send)
    cleared = _last(io, "server.spoolman.post_spool_id")
    assert cleared["params"]["spool_id"] is None
    controller.on_message(_ok(cleared["id"], {"spool_id": None}), send)
    assert controller.spoolman.active_id is None
    assert controller.spoolman.active_known is True


def test_reconnect_hides_the_previous_printer():
    io, send = _log()
    controller = Controller(MoonrakerSession(rng=ZeroRng()), PrinterStore(), {"displayName": "Trident", "moonrakerUrl": "http://localhost:7125"})
    _ready(controller, io, send)
    _answer_catalog(controller, io, send, [_spool(4, name="Only On A")], spool_id=4)
    assert _view(controller)["spoolman"]["rows"][0]["name"] == "Only On A"
    controller.on_close("Connection closed", send)
    hidden = _view(controller)
    assert hidden["spoolman"]["phase"] == "hidden"
    assert hidden["spoolman"]["rows"] == []
    assert hidden["spool"]["visible"] is False
    controller.on_timer("reconnect", send)
    controller.on_open(send)
    identify = _last(io, "server.connection.identify")
    controller.on_message(_ok(identify["id"], {"connection_id": 2}), send)
    info = _last(io, "server.info")
    controller.on_message(_ok(info["id"], {"klippy_connected": True, "klippy_state": "ready"}), send)
    printer = _last(io, "printer.info")
    controller.on_message(_ok(printer["id"], {"hostname": "other-host", "state": "ready", "state_message": ""}), send)
    listing = _last(io, "printer.objects.list")
    controller.on_message(_ok(listing["id"], {"objects": ["print_stats", "toolhead", "extruder"]}), send)
    subscribe = _last(io, "printer.objects.subscribe")
    controller.on_message(_ok(subscribe["id"], {"status": {"print_stats": {"state": "standby"}, "toolhead": {"homed_axes": "xyz", "position": [0, 0, 0, 0]}}}), send)
    _answer_catalog(controller, io, send, [_spool(9, name="Only On B", material="ASA", vendor="Prusa")], spool_id=None)
    again = _view(controller)
    blob = json.dumps(again["spoolman"])
    assert "Only On A" not in blob
    assert "Only On B" in blob
    assert again["spoolman"]["printerKey"] == "http://localhost:7125"
    controller.save_settings("Other", "http://10.0.0.8:7125", "midnight", True, 0)
    assert controller.spoolman.printer_key == "http://10.0.0.8:7125"
    assert controller.spoolman.spools == []
    controller.reconnect(send)
    assert all(row["name"] != "Only On B" for row in controller.spoolman.spools)


def test_notify_and_link_refresh_without_leaking_state():
    io, send = _log()
    controller = Controller(MoonrakerSession(rng=ZeroRng()), PrinterStore(), {"moonrakerUrl": "http://localhost:7125", "displayName": "Trident"})
    _ready(controller, io, send)
    _answer_catalog(controller, io, send, [_spool(4)], spool_id=4)
    controller.on_message(json.dumps({"jsonrpc": "2.0", "method": "notify_active_spool_set", "params": [{"spool_id": None}]}), send)
    assert controller.spoolman.active_id is None
    controller.on_message(json.dumps({"jsonrpc": "2.0", "method": "notify_spoolman_status_changed", "params": [{"spoolman_connected": False}]}), send)
    assert controller.spoolman.phase == "offline"
    assert controller.spoolman.spools == []
    controller.on_message(json.dumps({"jsonrpc": "2.0", "method": "notify_spoolman_status_changed", "params": [{"spoolman_connected": True}]}), send)
    assert _last(io, "server.spoolman.status")["id"]


def test_filament_qml_scrolls_and_offscreen_loads_both_sizes():
    page = (ROOT / "qml" / "FilamentPage.qml").read_text(encoding="utf-8")
    assert "ListView" in page
    assert "Flickable" in page
    assert "Shift ↑" in page
    assert "height: 240" in page
    assert "boundsBehavior: Flickable.StopAtBounds" in page
    for forbidden in ("printer.gcode", "G28", "server.spoolman", "https://"):
        assert forbidden not in page
    verify = (ROOT / "scripts" / "verify.sh").read_text(encoding="utf-8")
    assert "--page filament --geometry 1024x600" in verify
    assert "--page filament --geometry 800x480" in verify
    if subprocess.call([sys.executable, "-c", "import PyQt6.QtQuick"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
        pytest.skip("PyQt6 is not installed")
    env = os.environ.copy()
    env.update({"QT_QPA_PLATFORM": "offscreen", "QT_QUICK_BACKEND": "software", "QSG_RENDER_LOOP": "basic"})
    for geometry in ("1024x600", "800x480"):
        subprocess.check_call(
            [sys.executable, "-m", "layr_qt", "--self-check", "--fixture", "printing", "--page", "filament", "--geometry", geometry],
            cwd=ROOT,
            env=env,
        )
