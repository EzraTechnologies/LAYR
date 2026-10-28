"""Moonraker WebSocket session that does not own a socket.

The Qt host applies the returned actions (connect, send, close, timers). Tests
feed ``on_open``, ``on_message``, ``on_close``, and ``on_timer`` directly.
"""

from __future__ import annotations

from typing import Any

from layr_qt.moonraker.backoff import Backoff
from layr_qt.moonraker.files import gcodes_api_path, map_directory, map_metadata, pick_thumbnail, safe_gcode_filename, safe_relative
from layr_qt.actions.gateway import clean_klipper_message
from layr_qt.moonraker.protocol import (
    config_settings_from,
    decode_message,
    encode_request,
    plan_subscription,
    status_diff_from_params,
)
from layr_qt.moonraker.status import parse_klippy_state

IDENTIFY_PARAMS = {
    "client_name": "LAYR Qt",
    "version": "0.2.0",
    "type": "display",
    "url": "https://github.com/EzraTechnologies/LAYR",
}
RPC_TIMEOUT_MS = 10_000
KLIPPY_POLL_MS = 2_000


def event(payload: dict) -> dict:
    return {"kind": "event", "event": payload}


class MoonrakerSession:
    def __init__(self, rng: Any | None = None) -> None:
        self.backoff = Backoff(rng=rng)
        self.transport = "idle"
        self.running = False
        self.pending: dict[int, dict] = {}
        self.control: dict[int, dict] = {}
        self.next_id = 1
        self._retry_armed = False
        self._klippy = "unknown"

    def start(self) -> list[dict]:
        self.running = True
        self.backoff.reset()
        return self._begin_connect()

    def stop(self) -> list[dict]:
        dropped = list(self.control.values())
        self.running = False
        self.pending.clear()
        self.control.clear()
        self.transport = "idle"
        self._retry_armed = False
        self.backoff.reset()
        actions: list[dict] = [
            {"kind": "close"},
            {"kind": "cancel_timers"},
            event({"type": "transport", "state": "idle", "attempt": 0, "reason": None}),
        ]
        for info in dropped:
            actions.append(
                event(
                    {
                        "type": "command",
                        "status": "unconfirmed",
                        "group": info.get("group") or "",
                        "summary": info.get("summary") or "Command",
                        "message": "Connection closed before Moonraker replied. Check the printer before retrying",
                    }
                )
            )
        return actions

    def on_open(self) -> list[dict]:
        if not self.running or self.transport != "connecting":
            return []
        return [self._rpc("server.connection.identify", IDENTIFY_PARAMS, "identify")]

    def on_connect_failed(self, reason: str) -> list[dict]:
        return self._fail(reason or "Could not open Moonraker")

    def on_close(self, reason: str | None = None) -> list[dict]:
        if not self.running or self.transport in ("idle", "waiting"):
            return []
        return self._fail(reason or "Connection closed")

    def on_message(self, text: str) -> list[dict]:
        if not self.running or self.transport not in ("connecting", "connected"):
            return []
        message = decode_message(text)
        if message is None:
            return []
        if "id" in message and message.get("id") in self.control:
            return self._handle_control(message)
        if "id" in message and message.get("id") in self.pending:
            return self._handle_response(message)
        method = message.get("method")
        if method == "notify_status_update":
            diff = status_diff_from_params(message.get("params"))
            if not diff:
                return []
            return [event({"type": "status", "diff": diff})]
        if method == "notify_klippy_ready":
            return self._init_printer()
        if method == "notify_klippy_disconnected":
            self._klippy = "disconnected"
            actions = [event({"type": "klippy", "state": "disconnected", "message": "Klipper disconnected"})]
            actions.append({"kind": "timer", "name": "klippy", "ms": KLIPPY_POLL_MS})
            return actions
        if method == "notify_klippy_shutdown":
            self._klippy = "shutdown"
            detail = _shutdown_message(message.get("params"))
            return [event({"type": "klippy", "state": "shutdown", "message": detail or "Klipper shutdown"})]
        return []

    def on_timer(self, name: str) -> list[dict]:
        if not self.running:
            return []
        if name == "reconnect":
            self._retry_armed = False
            return self._begin_connect()
        if name == "klippy":
            if self.transport != "connected" or self._klippy == "ready":
                return []
            return [self._rpc("server.info", {}, "server.info")]
        if name == "rpc":
            if not self.pending:
                return []
            return self._fail("Moonraker did not answer")
        if name.startswith("cmd"):
            return self._control_timeout(name)
        return []

    def submit_control(self, plan: dict) -> list[dict]:
        """Send one gateway plan. Does not treat a missing reply as success."""
        summary = plan.get("summary") or "Command"
        group = plan.get("group") or ""
        if self.transport != "connected":
            return [
                event(
                    {
                        "type": "command",
                        "status": "unconfirmed",
                        "group": group,
                        "summary": summary,
                        "message": f"{summary} was not acknowledged. Check the printer before retrying",
                    }
                )
            ]
        rpc_id = self.next_id
        self.next_id += 1
        self.control[rpc_id] = {
            "group": group,
            "summary": summary,
            "note": plan.get("note"),
            "settle": plan.get("settle"),
            "record": plan.get("record"),
            "follow": plan.get("follow"),
        }
        timeout = int(plan.get("timeoutMs") or RPC_TIMEOUT_MS)
        return [
            {"kind": "send", "text": encode_request(rpc_id, plan["method"], plan.get("params"), control=True)},
            {"kind": "timer", "name": f"cmd{rpc_id}", "ms": timeout},
        ]

    def request_directory(self, relative: str) -> list[dict]:
        api_path = gcodes_api_path(relative)
        folder = "" if relative.strip() == "" else safe_relative(relative)
        if api_path is None or folder is None:
            return [event({"type": "directory", "relative": "", "error": "That folder is not available", "dirs": [], "files": []})]
        if self.transport != "connected":
            return [event({"type": "directory", "relative": folder, "error": "Offline", "dirs": [], "files": []})]
        return [self._rpc("server.files.get_directory", {"path": api_path, "extended": True}, "directory", {"relative": folder})]

    def request_metadata(self, filename: str, purpose: str) -> list[dict]:
        safe = safe_gcode_filename(filename)
        if safe is None:
            return [event(_metadata_event(purpose, filename, error="Unsupported file name"))]
        if self.transport != "connected":
            return [event(_metadata_event(purpose, safe, error="Offline"))]
        return [self._rpc("server.files.metadata", {"filename": safe}, purpose, {"filename": safe})]

    def _begin_connect(self) -> list[dict]:
        self.transport = "connecting"
        self.pending.clear()
        self.control.clear()
        self._retry_armed = False
        self._klippy = "unknown"
        return [
            {"kind": "cancel_timer", "name": "reconnect"},
            {"kind": "connect"},
            event({"type": "transport", "state": "connecting", "attempt": self.backoff.attempt, "reason": None}),
        ]

    def _fail(self, reason: str) -> list[dict]:
        if not self.running:
            return [{"kind": "close"}, {"kind": "cancel_timers"}]
        if self.transport == "waiting" and self._retry_armed:
            return []
        dropped = list(self.control.values())
        self.pending.clear()
        self.control.clear()
        self.transport = "waiting"
        self._klippy = "unknown"
        delay = self.backoff.next_ms()
        self._retry_armed = True
        actions: list[dict] = [
            {"kind": "close"},
            {"kind": "cancel_timers"},
            {"kind": "timer", "name": "reconnect", "ms": delay},
            event({"type": "transport", "state": "waiting", "attempt": self.backoff.attempt, "reason": reason, "nextRetryMs": delay}),
        ]
        for info in dropped:
            actions.append(
                event(
                    {
                        "type": "command",
                        "status": "unconfirmed",
                        "group": info.get("group") or "",
                        "summary": info.get("summary") or "Command",
                        "message": f"{reason} before Moonraker replied. Check the printer before retrying",
                    }
                )
            )
        return actions

    def _control_timeout(self, name: str) -> list[dict]:
        try:
            rpc_id = int(name[3:])
        except ValueError:
            return []
        info = self.control.pop(rpc_id, None)
        if info is None:
            return []
        summary = info.get("summary") or "Command"
        return [
            event(
                {
                    "type": "command",
                    "status": "unconfirmed",
                    "group": info.get("group") or "",
                    "summary": summary,
                    "message": f"{summary} was not acknowledged. Check the printer before retrying",
                }
            )
        ]

    def _handle_control(self, message: dict) -> list[dict]:
        info = self.control.pop(message.get("id"), None)
        if info is None:
            return []
        actions: list[dict] = [{"kind": "cancel_timer", "name": f"cmd{message.get('id')}"}]
        error = message.get("error")
        summary = info.get("summary") or "Command"
        if error:
            if isinstance(error, dict):
                text = error.get("message") or "Moonraker error"
            else:
                text = str(error)
            actions.append(
                event(
                    {
                        "type": "command",
                        "status": "failed",
                        "group": info.get("group") or "",
                        "summary": summary,
                        "message": clean_klipper_message(str(text)),
                    }
                )
            )
            return actions
        actions.append(
            event(
                {
                    "type": "command",
                    "status": "ok",
                    "group": info.get("group") or "",
                    "summary": summary,
                    "note": info.get("note"),
                    "settle": info.get("settle"),
                    "record": info.get("record"),
                    "follow": info.get("follow"),
                }
            )
        )
        return actions

    def _rpc(self, method: str, params: dict, purpose: str, meta: dict | None = None) -> dict:
        rpc_id = self.next_id
        self.next_id += 1
        self.pending[rpc_id] = {"purpose": purpose, "meta": meta or {}}
        return {
            "kind": "send",
            "text": encode_request(rpc_id, method, params),
            "armRpcTimeoutMs": RPC_TIMEOUT_MS,
        }

    def _handle_response(self, message: dict) -> list[dict]:
        info = self.pending.pop(message["id"], None)
        if info is None:
            return []
        actions: list[dict] = []
        if not self.pending:
            actions.append({"kind": "cancel_timer", "name": "rpc"})
        error = message.get("error")
        if error:
            text = error.get("message") if isinstance(error, dict) else "Moonraker error"
            return actions + self._rpc_error(info, text or "Moonraker error")
        result = message.get("result")
        return actions + self._rpc_result(info, result if isinstance(result, dict) else {})

    def _rpc_error(self, info: dict, text: str) -> list[dict]:
        purpose = info["purpose"]
        if purpose in ("identify", "server.info", "printer.info", "objects", "subscribe"):
            return self._fail(text)
        if purpose == "directory":
            return [event({"type": "directory", "relative": info["meta"].get("relative", ""), "error": text, "dirs": [], "files": []})]
        if purpose in ("job", "file"):
            return [event(_metadata_event(purpose, info["meta"].get("filename", ""), error=text))]
        return []

    def _rpc_result(self, info: dict, result: dict) -> list[dict]:
        purpose = info["purpose"]
        if purpose == "identify":
            self.backoff.reset()
            self.transport = "connected"
            return [
                event({"type": "transport", "state": "connected", "attempt": 0, "reason": None}),
                self._rpc("server.info", {}, "server.info"),
            ]
        if purpose == "server.info":
            return self._on_server_info(result)
        if purpose == "printer.info":
            return self._on_printer_info(result)
        if purpose == "objects":
            return self._on_objects(result)
        if purpose == "subscribe":
            return self._on_subscribe(result)
        if purpose == "directory":
            relative = info["meta"].get("relative", "")
            mapped = map_directory(relative, result)
            return [event({"type": "directory", "relative": relative, "error": "", **mapped})]
        if purpose in ("job", "file"):
            filename = info["meta"].get("filename", "")
            meta = map_metadata(filename, result)
            thumb = pick_thumbnail(meta["thumbnails"], 96)
            return [
                event(
                    {
                        "type": "metadata",
                        "purpose": purpose,
                        "filename": filename,
                        "error": "",
                        "estimated_time": meta["estimatedTime"],
                        "thumbnail_path": None if thumb is None else thumb["path"],
                        "meta": meta,
                    }
                )
            ]
        return []

    def _on_server_info(self, result: dict) -> list[dict]:
        if result.get("klippy_connected") is False:
            state = "disconnected"
        else:
            state = parse_klippy_state(result.get("klippy_state"))
        self._klippy = state
        if state == "ready":
            return self._init_printer()
        message = "Klipper is not ready" if state == "unknown" else None
        actions = [event({"type": "klippy", "state": state, "message": message})]
        actions.append({"kind": "timer", "name": "klippy", "ms": KLIPPY_POLL_MS})
        return actions

    def _init_printer(self) -> list[dict]:
        if self.transport != "connected":
            return []
        return [self._rpc("printer.info", {}, "printer.info")]

    def _on_printer_info(self, result: dict) -> list[dict]:
        hostname = result.get("hostname").strip() if isinstance(result.get("hostname"), str) else ""
        actions: list[dict] = []
        if hostname:
            actions.append(event({"type": "host", "hostname": hostname}))
        state = parse_klippy_state(result.get("state"))
        message = result.get("state_message").strip() if isinstance(result.get("state_message"), str) else None
        self._klippy = state
        if state != "ready":
            actions.append(event({"type": "klippy", "state": state, "message": message}))
            actions.append({"kind": "timer", "name": "klippy", "ms": KLIPPY_POLL_MS})
            return actions
        actions.append(self._rpc("printer.objects.list", {}, "objects"))
        return actions

    def _on_objects(self, result: dict) -> list[dict]:
        raw_objects = result.get("objects")
        names = [item for item in raw_objects if isinstance(item, str)] if isinstance(raw_objects, list) else []
        plan = plan_subscription(names)
        self._object_names = names
        self._missing = plan["missing"]
        return [self._rpc("printer.objects.subscribe", {"objects": plan["objects"]}, "subscribe", {"objects": names, "missing": plan["missing"]})]

    def _on_subscribe(self, result: dict) -> list[dict]:
        status = result.get("status") if isinstance(result.get("status"), dict) else {}
        settings = config_settings_from(status) or {}
        objects = getattr(self, "_object_names", [])
        missing = getattr(self, "_missing", [])
        self._klippy = "ready"
        return [
            event(
                {
                    "type": "snapshot",
                    "status": status,
                    "settings": settings,
                    "objects": objects,
                    "missing": missing,
                    "klippy": "ready",
                }
            )
        ]


def _metadata_event(purpose: str, filename: str, error: str) -> dict:
    return {
        "type": "metadata",
        "purpose": purpose,
        "filename": filename,
        "error": error,
        "estimated_time": None,
        "thumbnail_path": None,
        "meta": None,
    }


def _shutdown_message(params: object) -> str | None:
    if isinstance(params, list):
        for item in params:
            if isinstance(item, str) and item.strip():
                return item.strip()
    if isinstance(params, str) and params.strip():
        return params.strip()
    return None
