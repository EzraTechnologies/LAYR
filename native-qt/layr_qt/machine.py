"""Moonraker JSON-RPC state machine.

The network loop lives in session.py. This object is synchronous so tests can
feed frames without a socket. It only sends methods in READ_METHODS.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable

from .backoff import Backoff
from .extensions import READ_METHODS, is_allowed_method
from .mapping import config_settings_from, parse_klippy_state
from .subscription import plan_subscription
from .urls import to_websocket_url

REQUEST_TIMEOUT_S = 10.0
KLIPPY_POLL_S = 2.0
CLIENT_VERSION = "0.1.0"
IDENTIFY = {
    "client_name": "LAYR Qt",
    "version": CLIENT_VERSION,
    "type": "display",
    "url": "https://github.com/EzraTechnologies/LAYR",
}


@dataclass
class Effect:
    kind: str
    data: dict[str, Any] = field(default_factory=dict)


class MoonrakerMachine:
    def __init__(self, base_url: str, backoff: Backoff | None = None) -> None:
        self.base_url = base_url
        self.backoff = backoff or Backoff()
        self.running = False
        self.generation = 0
        self.phase = "idle"
        self.klippy = "unknown"
        self.initializing = False
        self.next_id = 1
        self.pending: dict[int, dict[str, Any]] = {}
        self.retry_at: float | None = None
        self.poll_at: float | None = None
        self._effects: list[Effect] = []

    def start(self, now: float) -> list[Effect]:
        if self.running:
            return []
        self.running = True
        self.backoff.reset()
        self._begin_connect(now)
        return self._take()

    def stop(self, now: float) -> list[Effect]:
        closing = self.generation
        self.running = False
        self.generation += 1
        self.phase = "idle"
        self.pending.clear()
        self.initializing = False
        self.retry_at = None
        self.poll_at = None
        self._event({"type": "transport", "state": "idle", "attempt": 0, "reason": None})
        self._effects.append(Effect("close", {"generation": closing, "reason": "Client stopped"}))
        return self._take()

    def reconnect(self, now: float) -> list[Effect]:
        effects: list[Effect] = []
        if self.running:
            effects.extend(self.stop(now))
        effects.extend(self.start(now))
        return effects

    def request(self, method: str, params: dict[str, Any] | None, token: str, now: float) -> list[Effect]:
        if self.phase != "open":
            self._event({"type": "rpc_error", "token": token, "message": "Not connected to Moonraker"})
            return self._take()
        self._send(method, params, now, token=token)
        return self._take()

    def on_open(self, generation: int, now: float) -> list[Effect]:
        if generation != self.generation or not self.running:
            return []
        self.phase = "open"
        self._send("server.connection.identify", dict(IDENTIFY), now, token="identify")
        return self._take()

    def on_message(self, generation: int, text: str, now: float) -> list[Effect]:
        if generation != self.generation or not self.running:
            return []
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            return []
        if not isinstance(message, dict):
            return []
        if isinstance(message.get("id"), int):
            self._on_response(message, now)
        elif isinstance(message.get("method"), str):
            self._on_notification(message, now)
        return self._take()

    def on_close(self, generation: int, reason: str, now: float) -> list[Effect]:
        if generation != self.generation or not self.running:
            return []
        self.generation += 1
        self.pending.clear()
        self.initializing = False
        self.phase = "waiting"
        self.klippy = "unknown"
        self.poll_at = None
        delay_ms = self.backoff.next_ms()
        self.retry_at = now + delay_ms / 1000
        self._event(
            {
                "type": "transport",
                "state": "waiting",
                "attempt": self.backoff.attempt,
                "reason": reason,
                "nextRetryAt": self.retry_at,
            }
        )
        return self._take()

    def tick(self, now: float) -> list[Effect]:
        if not self.running:
            return []
        if self.phase == "waiting" and self.retry_at is not None and now >= self.retry_at:
            self._begin_connect(now)
        timed_out = [item for item in self.pending.values() if item["deadline"] <= now]
        if timed_out and self.phase == "open":
            method = timed_out[0]["method"]
            self._effects.append(
                Effect("close", {"generation": self.generation, "reason": f'No reply from Moonraker for "{method}"'})
            )
        elif (
            self.phase == "open"
            and self.klippy != "ready"
            and self.poll_at is not None
            and now >= self.poll_at
            and not self._pending_method("server.info")
        ):
            self.poll_at = None
            self._send("server.info", None, now, token="server.info")
        return self._take()

    def _begin_connect(self, now: float) -> None:
        self.generation += 1
        self.phase = "connecting"
        self.klippy = "unknown"
        self.pending.clear()
        self.initializing = False
        self.retry_at = None
        self.poll_at = None
        self._event({"type": "transport", "state": "connecting", "attempt": self.backoff.attempt, "reason": None})
        self._effects.append(
            Effect("connect", {"url": to_websocket_url(self.base_url), "generation": self.generation})
        )

    def _send(self, method: str, params: dict[str, Any] | None, now: float, token: str) -> None:
        if not is_allowed_method(method):
            self._event({"type": "rejected", "method": method, "token": token})
            return
        request_id = self.next_id
        self.next_id += 1
        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "id": request_id}
        if params is not None:
            body["params"] = params
        self.pending[request_id] = {
            "method": method,
            "token": token,
            "deadline": now + REQUEST_TIMEOUT_S,
        }
        self._effects.append(Effect("send", {"text": json.dumps(body), "generation": self.generation}))

    def _on_response(self, message: dict[str, Any], now: float) -> None:
        pending = self.pending.pop(message["id"], None)
        if pending is None:
            return
        if message.get("error"):
            error = message["error"]
            text = error.get("message") if isinstance(error, dict) else "Moonraker error"
            self._fail_or_report(pending, str(text), now)
            return
        self._on_result(pending, message.get("result"), now)

    def _fail_or_report(self, pending: dict[str, Any], message: str, now: float) -> None:
        token = pending["token"]
        if token in {"identify", "server.info", "init_printer", "objects", "subscribe", "config"}:
            self._effects.append(Effect("close", {"generation": self.generation, "reason": message}))
            return
        self._event({"type": "rpc_error", "token": token, "message": message})

    def _on_result(self, pending: dict[str, Any], result: Any, now: float) -> None:
        token = pending["token"]
        if not isinstance(result, dict):
            result = {}
        if token == "identify":
            self.backoff.reset()
            self._event({"type": "transport", "state": "connected", "attempt": 0, "reason": None})
            self._send("server.info", None, now, token="server.info")
            return
        if token == "server.info":
            self._handle_server_info(result, now)
            return
        if token == "init_printer":
            hostname = result.get("hostname")
            if isinstance(hostname, str) and hostname.strip():
                self._event({"type": "host", "hostname": hostname.strip()})
            state = parse_klippy_state(result.get("state") or "ready")
            message = result.get("state_message")
            self.klippy = state
            self._event(
                {
                    "type": "klippy",
                    "state": state,
                    "message": message.strip() if isinstance(message, str) and state != "ready" else None,
                }
            )
            if state == "ready":
                self._send("printer.objects.list", None, now, token="objects")
            else:
                self.initializing = False
                self._schedule_poll(now)
            return
        if token == "objects":
            names = result.get("objects")
            available = [item for item in names if isinstance(item, str)] if isinstance(names, list) else []
            plan = plan_subscription(available)
            self._objects = available
            self._missing = plan["missing"]
            self._send(
                "printer.objects.subscribe",
                {"objects": plan["objects"]},
                now,
                token="subscribe",
            )
            return
        if token == "subscribe":
            status = result.get("status") if isinstance(result.get("status"), dict) else {}
            settings = config_settings_from(status)
            if settings is None and "configfile" in getattr(self, "_objects", []):
                self._pending_status = status
                self._send(
                    "printer.objects.query",
                    {"objects": {"configfile": ["settings"]}},
                    now,
                    token="config",
                )
                return
            self._emit_snapshot(status, settings or {})
            return
        if token == "config":
            status = getattr(self, "_pending_status", {})
            settings = config_settings_from(result.get("status") if isinstance(result, dict) else None) or {}
            self._emit_snapshot(status, settings)
            return
        self._event({"type": "rpc", "token": token, "result": result})

    def _handle_server_info(self, result: dict[str, Any], now: float) -> None:
        if result.get("klippy_connected") is False:
            state = "disconnected"
        else:
            state = parse_klippy_state(result.get("klippy_state"))
        self.klippy = state
        self._event({"type": "klippy", "state": state, "message": None})
        if state == "ready":
            self._begin_init(now)
            return
        self._schedule_poll(now)

    def _begin_init(self, now: float) -> None:
        if self.initializing:
            return
        self.initializing = True
        self._send("printer.info", None, now, token="init_printer")

    def _emit_snapshot(self, status: dict[str, Any], settings: dict[str, Any]) -> None:
        self.initializing = False
        self.klippy = "ready"
        self._event(
            {
                "type": "snapshot",
                "status": status,
                "missing": list(getattr(self, "_missing", [])),
                "hostname": None,
                "objects": list(getattr(self, "_objects", [])),
                "settings": settings,
            }
        )
        self._event({"type": "klippy", "state": "ready", "message": None})

    def _on_notification(self, message: dict[str, Any], now: float) -> None:
        method = message["method"]
        params = message.get("params")
        if method == "notify_status_update":
            diff = params[0] if isinstance(params, list) and params else None
            if isinstance(diff, dict):
                self._event({"type": "status", "diff": diff})
                webhooks = diff.get("webhooks")
                if isinstance(webhooks, dict) and isinstance(webhooks.get("state"), str):
                    state = parse_klippy_state(webhooks["state"])
                    if state != self.klippy:
                        self.klippy = state
                        text = webhooks.get("state_message") if isinstance(webhooks.get("state_message"), str) else None
                        self._event({"type": "klippy", "state": state, "message": text})
                        if state != "ready":
                            self._schedule_poll(now)
            return
        if method == "notify_klippy_ready":
            self.klippy = "ready"
            self._begin_init(now)
            return
        if method == "notify_klippy_shutdown":
            self.klippy = "shutdown"
            self._event({"type": "klippy", "state": "shutdown", "message": None})
            self._schedule_poll(now)
            return
        if method == "notify_klippy_disconnected":
            self.klippy = "disconnected"
            self._event({"type": "klippy", "state": "disconnected", "message": None})
            self._schedule_poll(now)
            return
        if method == "notify_filelist_changed":
            info = params[0] if isinstance(params, list) and params and isinstance(params[0], dict) else {}
            item = info.get("item") if isinstance(info.get("item"), dict) else {}
            self._event(
                {
                    "type": "filelist",
                    "action": info.get("action") if isinstance(info.get("action"), str) else "unknown",
                    "path": item.get("path") if isinstance(item.get("path"), str) else None,
                }
            )

    def _schedule_poll(self, now: float) -> None:
        self.poll_at = now + KLIPPY_POLL_S

    def _pending_method(self, method: str) -> bool:
        return any(item["method"] == method for item in self.pending.values())

    def _event(self, event: dict[str, Any]) -> None:
        self._effects.append(Effect("event", event))

    def _take(self) -> list[Effect]:
        effects = self._effects
        self._effects = []
        return effects


def decode_send(effect: Effect) -> dict[str, Any]:
    if effect.kind != "send":
        raise ValueError(effect.kind)
    return json.loads(effect.data["text"])


NowFn = Callable[[], float]
