"""Moonraker state machine and a scripted session."""

from __future__ import annotations

import asyncio
import json
import unittest

from layr_qt.backoff import Backoff, BackoffOptions
from layr_qt.machine import MoonrakerMachine, decode_send
from layr_qt.session import Session
from layr_qt.viewmodel import ViewModel

OBJECTS = [
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
    "mmu",
]


def _result(request_id: int, result: dict) -> str:
    return json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result})


class MachineTests(unittest.TestCase):
    def test_handshake_subscribes_and_refuses_gcode(self) -> None:
        machine = MoonrakerMachine("http://localhost:7125", Backoff(BackoffOptions(jitter=0)))
        effects = machine.start(0)
        self.assertEqual(effects[0].kind, "event")
        self.assertEqual(effects[1].kind, "connect")
        self.assertTrue(effects[1].data["url"].endswith("/websocket"))
        generation = effects[1].data["generation"]

        opened = machine.on_open(generation, 0)
        identify = decode_send(opened[-1])
        self.assertEqual(identify["method"], "server.connection.identify")
        self.assertEqual(identify["params"]["client_name"], "LAYR Qt")

        connected = machine.on_message(generation, _result(identify["id"], {"connection_id": 7}), 0.1)
        self.assertEqual(decode_send(connected[-1])["method"], "server.info")
        info_id = decode_send(connected[-1])["id"]
        ready = machine.on_message(
            generation,
            _result(info_id, {"klippy_state": "ready", "klippy_connected": True}),
            0.2,
        )
        self.assertEqual(decode_send(ready[-1])["method"], "printer.info")
        printer_id = decode_send(ready[-1])["id"]
        listed = machine.on_message(
            generation,
            _result(printer_id, {"hostname": "voron", "state": "ready", "state_message": ""}),
            0.3,
        )
        self.assertEqual(decode_send(listed[-1])["method"], "printer.objects.list")
        list_id = decode_send(listed[-1])["id"]
        subscribed = machine.on_message(generation, _result(list_id, {"objects": OBJECTS}), 0.4)
        request = decode_send(subscribed[-1])
        self.assertEqual(request["method"], "printer.objects.subscribe")
        self.assertEqual(request["params"]["objects"]["motion_report"], ["live_velocity", "live_extruder_velocity"])
        self.assertNotIn("mmu", request["params"]["objects"])
        self.assertIn("extruder", request["params"]["objects"])

        refused = machine.request("printer.gcode.script", {"script": "G28"}, "nope", 0.5)
        self.assertTrue(any(item.kind == "event" and item.data.get("type") == "rejected" for item in refused))
        self.assertFalse(any(item.kind == "send" for item in refused))

        status = {
            "extruder": {"temperature": 210, "target": 215, "can_extrude": True},
            "heater_bed": {"temperature": 60, "target": 60},
            "print_stats": {"filename": "part.gcode", "state": "printing", "print_duration": 10, "total_duration": 12},
            "display_status": {"progress": 0.2},
            "motion_report": {"live_velocity": 15, "live_extruder_velocity": 1},
            "configfile": {"settings": {"extruder": {"filament_diameter": "1.75"}}},
            "toolhead": {"extruder": "extruder"},
        }
        snap = machine.on_message(generation, _result(request["id"], {"status": status}), 0.6)
        events = [item.data for item in snap if item.kind == "event"]
        self.assertTrue(any(item.get("type") == "snapshot" for item in events))

    def test_reconnect_backoff(self) -> None:
        machine = MoonrakerMachine("http://localhost:7125", Backoff(BackoffOptions(jitter=0)))
        start = machine.start(0)
        generation = next(item.data["generation"] for item in start if item.kind == "connect")
        closed = machine.on_close(generation, "Connection closed", 5)
        waiting = next(item.data for item in closed if item.kind == "event")
        self.assertEqual(waiting["state"], "waiting")
        self.assertEqual(waiting["attempt"], 1)
        self.assertEqual(machine.tick(5.5), [])
        again = machine.tick(6)
        self.assertTrue(any(item.kind == "connect" for item in again))

    def test_klippy_disconnect_notification(self) -> None:
        machine = MoonrakerMachine("http://localhost:7125", Backoff(BackoffOptions(jitter=0)))
        machine.running = True
        machine.phase = "open"
        machine.generation = 3
        machine.klippy = "ready"
        effects = machine.on_message(
            3,
            json.dumps({"jsonrpc": "2.0", "method": "notify_klippy_disconnected", "params": [{}]}),
            1,
        )
        self.assertEqual(effects[0].data["state"], "disconnected")
        self.assertEqual(machine.poll_at, 3)


class ScriptedSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.incoming: asyncio.Queue[str] = asyncio.Queue()
        self.closed = False

    async def send(self, text: str) -> None:
        payload = json.loads(text)
        self.sent.append(payload)
        await self.incoming.put(json.dumps(self._reply(payload)))

    async def recv(self) -> str:
        return await self.incoming.get()

    async def close(self) -> None:
        self.closed = True

    def _reply(self, payload: dict) -> dict:
        method = payload["method"]
        request_id = payload["id"]
        if method == "server.connection.identify":
            result = {"connection_id": 1}
        elif method == "server.info":
            result = {"klippy_state": "ready", "klippy_connected": True}
        elif method == "printer.info":
            result = {"hostname": "pi", "state": "ready", "state_message": ""}
        elif method == "printer.objects.list":
            result = {"objects": OBJECTS}
        elif method == "printer.objects.subscribe":
            result = {
                "status": {
                    "extruder": {"temperature": 205.4, "target": 210, "can_extrude": True},
                    "heater_bed": {"temperature": 55, "target": 60},
                    "print_stats": {
                        "filename": "hook.gcode",
                        "state": "printing",
                        "print_duration": 80,
                        "total_duration": 90,
                        "info": {"current_layer": 4, "total_layer": 20},
                    },
                    "display_status": {"progress": 0.4},
                    "motion_report": {"live_velocity": 33.2, "live_extruder_velocity": 2},
                    "gcode_move": {"speed_factor": 1.8, "extrude_factor": 1.1},
                    "toolhead": {"extruder": "extruder", "homed_axes": "xyz", "position": [10, 20, 5, 0]},
                    "configfile": {"settings": {"extruder": {"filament_diameter": "1.75"}}},
                }
            }
        elif method == "server.files.metadata":
            result = {
                "estimated_time": 400,
                "thumbnails": [{"relative_path": ".thumbs/hook.png", "width": 160, "height": 160}],
            }
        elif method == "server.files.get_directory":
            result = {"dirs": [], "files": [{"filename": "hook.gcode", "size": 1000, "modified": 10}]}
        elif method == "printer.gcode.script":
            raise AssertionError("control method was sent")
        else:
            result = {}
        return {"jsonrpc": "2.0", "id": request_id, "result": result}


class SessionTests(unittest.TestCase):
    def test_scripted_session_reaches_a_printing_snapshot(self) -> None:
        asyncio.run(self._run())

    async def _run(self) -> None:
        socket = ScriptedSocket()
        model = ViewModel("", "http://localhost:7125")
        snapshots: list[dict] = []
        files: list[dict] = []
        thumbs: list[bytes | None] = []

        async def connect(_url: str) -> ScriptedSocket:
            return socket

        session = Session(
            MoonrakerMachine("http://localhost:7125", Backoff(BackoffOptions(jitter=0))),
            model,
            connect,
            snapshots.append,
            files.append,
            thumbs.append,
            now=lambda: 0,
            log=lambda _line: None,
        )
        task = asyncio.create_task(session.run())
        for _ in range(40):
            await asyncio.sleep(0)
            if snapshots and snapshots[-1].get("filename") == "hook" and snapshots[-1].get("speedText") == "33":
                break
        else:
            self.fail(f"no printing snapshot: {snapshots[-1] if snapshots else 'none'}")
        latest = snapshots[-1]
        self.assertEqual(latest["status"], "printing")
        self.assertEqual(latest["nozzle"]["temp"], "205")
        self.assertNotEqual(latest["speedText"], "180")
        self.assertEqual(latest["speedFactorText"], "180%")
        self.assertTrue(latest["flowText"])
        self.assertNotIn("%", latest["speedText"])
        session.submit(("directory", ""))
        for _ in range(80):
            await asyncio.sleep(0)
            if files and files[-1]["entries"]:
                break
            if task.done():
                self.fail(f"session stopped early: {task.exception()}")
        else:
            self.fail("directory was not published")
        self.assertEqual(files[-1]["entries"][0]["name"], "hook.gcode")
        session.submit(("printer-gcode-is-not-a-command",))
        session.submit(("stop",))
        await asyncio.wait_for(task, timeout=2)
        self.assertTrue(socket.closed or not session.machine.running)


if __name__ == "__main__":
    unittest.main()
