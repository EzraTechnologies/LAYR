"""Glue between the Moonraker session, the store, and preferences.

No Qt imports. The GUI and the tests both drive this object. Printer-changing
actions go through CommandGateway and are not sent in fixture mode.
"""

from __future__ import annotations

from layr_qt.actions.gateway import CommandGateway
from layr_qt.actions.model import build_snapshot
from layr_qt.moonraker.session import MoonrakerSession
from layr_qt.preferences import parse_preferences, sanitize_display_name
from layr_qt.moonraker.urls import validate_moonraker_url
from layr_qt.viewmodel import canonical_page

FIXTURE_MESSAGE = "Fixture mode does not connect to a printer."
MAX_CONSOLE = 80


class Controller:
    def __init__(self, session: MoonrakerSession, store, prefs: dict) -> None:
        self.session = session
        self.store = store
        self.prefs = parse_preferences(prefs)
        self.page = "home"
        self.settings_error = ""
        self.dimmed = False
        self.fixture = False
        self.gateway = CommandGateway()
        self.confirm: dict | None = None
        self.pending_command: dict | None = None
        self.toast: dict | None = None
        self.console: list[dict] = []
        self.console_draft = ""
        self.show_hidden = False
        self.settle: dict | None = None
        self._follow_directory = False

    def start(self, io) -> None:
        if self.fixture:
            return
        self._dispatch(self.session.start(), io)

    def stop(self, io) -> None:
        if self.fixture:
            return
        self._dispatch(self.session.stop(), io)

    def on_open(self, io) -> None:
        self._dispatch(self.session.on_open(), io)

    def on_message(self, text: str, io) -> None:
        self._dispatch(self.session.on_message(text), io)

    def on_close(self, reason: str, io) -> None:
        self._dispatch(self.session.on_close(reason), io)

    def on_connect_failed(self, reason: str, io) -> None:
        self._dispatch(self.session.on_connect_failed(reason), io)

    def on_timer(self, name: str, io) -> None:
        if name == "settle":
            self._finish_settle()
            return
        self._dispatch(self.session.on_timer(name), io)

    def open_page(self, page: str, io) -> None:
        page = canonical_page(page)
        if page is None:
            return
        self.page = page
        if page == "files" and not self.fixture and not self.store.directory_loaded:
            self._dispatch(self.session.request_directory(self.store.directory_relative), io)

    def open_directory(self, path: str, io) -> None:
        self.store.selected_path = None
        if self.fixture:
            return
        self._dispatch(self.session.request_directory(path), io)

    def select_file(self, path: str, io) -> None:
        self.store.selected_path = path
        entry = self.store.file_entry(path)
        if entry is None or entry.get("meta") is not None or self.fixture:
            return
        self._dispatch(self.session.request_metadata(path, "file"), io)

    def save_settings(self, display_name: str, moonraker_url: str, theme: str, hide_cursor: bool, dim_minutes: int) -> dict | None:
        url = validate_moonraker_url(moonraker_url)
        if url is None:
            self.settings_error = "Moonraker URL must be http:// or https:// with no password."
            return None
        if theme not in ("midnight", "black"):
            theme = "midnight"
        if dim_minutes not in (0, 1, 5, 10, 30):
            dim_minutes = 0
        previous = self.prefs["moonrakerUrl"]
        self.prefs = parse_preferences(
            {
                "moonrakerUrl": url,
                "displayName": sanitize_display_name(display_name),
                "theme": theme,
                "hideCursor": bool(hide_cursor),
                "dimAfterMinutes": dim_minutes,
            }
        )
        self.settings_error = ""
        return {"urlChanged": previous != self.prefs["moonrakerUrl"]}

    def reconnect(self, io) -> None:
        if self.fixture:
            return
        self._dispatch(self.session.stop(), io)
        self._dispatch(self.session.start(), io)

    def wake(self) -> None:
        self.dimmed = False

    def dismiss_toast(self) -> None:
        self.toast = None

    def toggle_hidden(self) -> None:
        self.show_hidden = not self.show_hidden

    def confirm_pending(self, io) -> None:
        command = self.pending_command
        self.pending_command = None
        self.confirm = None
        if command:
            self.request(command, io, confirmed=True)

    def dismiss_pending(self) -> None:
        self.pending_command = None
        self.confirm = None

    def home(self, axes: str, io) -> None:
        self.request({"kind": "home", "axes": _axes(axes)}, io)

    def jog(self, axis: str, distance: float, speed: float, io) -> None:
        self.request({"kind": "jog", "axis": axis, "distance": distance, "speed": speed}, io)

    def baby_step(self, delta: float, io) -> None:
        self.request({"kind": "z_offset", "delta": delta}, io)

    def motors_off(self, io) -> None:
        self.request({"kind": "motors_off"}, io)

    def set_heater(self, heater: str, target: float, io) -> None:
        self.request({"kind": "set_temperature", "heater": heater, "target": target}, io)

    def set_fan(self, fan: str, speed: float, io) -> None:
        self.request({"kind": "set_fan", "fan": fan, "speed": speed}, io)

    def set_light(self, light: str, value: float, io) -> None:
        self.request({"kind": "set_light", "light": light, "value": value}, io)

    def extrude(self, length: float, speed: float, io) -> None:
        self.request({"kind": "extrude", "length": length, "speed": speed}, io)

    def run_macro(self, name: str, io) -> None:
        self.request({"kind": "macro", "name": name}, io)

    def console_send(self, script: str, io) -> None:
        self.request({"kind": "gcode", "script": script}, io)

    def pause(self, io) -> None:
        self.request({"kind": "pause"}, io)

    def resume(self, io) -> None:
        self.request({"kind": "resume"}, io)

    def cancel(self, io) -> None:
        self.request({"kind": "cancel"}, io)

    def start_print(self, filename: str, io) -> None:
        self.request({"kind": "start_print", "filename": filename}, io)

    def delete_file(self, path: str, io) -> None:
        self.request({"kind": "delete_file", "path": path}, io)

    def emergency_stop(self, io) -> None:
        self.request({"kind": "emergency_stop"}, io)

    def restart_klipper(self, io) -> None:
        self.request({"kind": "restart"}, io)

    def firmware_restart(self, io) -> None:
        self.request({"kind": "firmware_restart"}, io)

    def set_speed_factor(self, percent: float, io) -> None:
        self.request({"kind": "set_speed_factor", "percent": percent}, io)

    def set_extrude_factor(self, percent: float, io) -> None:
        self.request({"kind": "set_extrude_factor", "percent": percent}, io)

    def request(self, command: dict, io, *, confirmed: bool = False) -> None:
        if self.fixture:
            self._toast("warn", FIXTURE_MESSAGE)
            return
        if self.confirm and command.get("kind") != "emergency_stop":
            self._toast("warn", "Answer the confirmation first")
            return
        if command.get("kind") == "emergency_stop":
            self.confirm = None
            self.pending_command = None
        try:
            outcome = self.gateway.begin(command, self.snapshot(), confirmed=confirmed)
        except (TypeError, ValueError):
            self._toast("warn", "That value cannot be sent")
            return
        status = outcome["status"]
        if status == "needs_confirmation":
            self.pending_command = outcome["command"]
            self.confirm = outcome["confirm"]
            return
        if status in ("blocked", "busy"):
            message = outcome["message"]
            if status == "blocked" and "Open it in the console" in message and command.get("name"):
                self.console_draft = f"{command['name']} "
                self.page = "more"
            self._toast("warn", message)
            return
        self._send_plan(outcome["plan"], io)

    def snapshot(self) -> dict:
        return build_snapshot(self.store, configured=bool(self.prefs.get("moonrakerUrl")))

    def ui_state(self) -> dict:
        return {
            "confirm": self.confirm,
            "toast": self.toast,
            "busy": sorted(self.gateway.inflight),
            "console": list(self.console),
            "consoleDraft": self.console_draft,
            "showHidden": self.show_hidden,
        }

    def _send_plan(self, plan: dict, io) -> None:
        self._dispatch(self.session.submit_control(plan), io)

    def _toast(self, tone: str, text: str) -> None:
        self.toast = {"tone": tone, "text": text}

    def _finish_settle(self) -> None:
        if not self.settle:
            return
        group = self.settle.get("group") or ""
        self.settle = None
        if group:
            self.gateway.release(group)

    def _check_settle(self) -> list[dict]:
        spec = self.settle
        if not spec:
            return []
        toolhead = self.snapshot().get("toolhead") or {}
        position = toolhead.get("position")
        if not position:
            return []
        index = {"x": 0, "y": 1, "z": 2}.get(spec.get("axis") or "")
        if index is None or index >= len(position):
            return []
        if abs(position[index] - float(spec["target"])) < 0.01:
            group = spec.get("group") or ""
            self.settle = None
            if group:
                self.gateway.release(group)
            return [{"kind": "cancel_timer", "name": "settle"}]
        return []

    def _on_command_result(self, event: dict) -> list[dict]:
        group = event.get("group") or ""
        status = event.get("status")
        summary = event.get("summary") or "Command"
        extra: list[dict] = []
        if status == "ok" and event.get("settle"):
            self.settle = {"group": group, "axis": event["settle"]["axis"], "target": event["settle"]["target"]}
            extra.append({"kind": "timer", "name": "settle", "ms": 3000})
            self._toast("ok", _ok_text(event))
        else:
            if group:
                self.gateway.release(group)
            if self.settle and self.settle.get("group") == group:
                self.settle = None
                extra.append({"kind": "cancel_timer", "name": "settle"})
            if status == "ok":
                self._toast("ok", _ok_text(event))
                if event.get("record"):
                    self._log_console("command", str(event["record"]))
                if event.get("follow") == "directory":
                    self._follow_directory = True
            elif status == "failed":
                self._toast("danger", f"{summary} failed. {event.get('message') or ''}".strip())
                if event.get("record"):
                    self._log_console("error", str(event["record"]))
            elif status == "unconfirmed":
                self._toast("warn", event.get("message") or f"{summary} was not acknowledged. Check the printer before retrying")
        return extra

    def _log_console(self, kind: str, text: str) -> None:
        self.console.append({"kind": kind, "text": text})
        if len(self.console) > MAX_CONSOLE:
            self.console = self.console[-MAX_CONSOLE:]

    def _consume_event(self, event: dict) -> list[dict]:
        if event.get("type") == "command":
            return self._on_command_result(event)
        self.store.apply(event)
        if event.get("type") in ("status", "snapshot"):
            return self._check_settle()
        return []

    def _dispatch(self, actions: list[dict], io) -> None:
        io_actions: list[dict] = []
        for action in actions:
            if action.get("kind") == "event":
                io_actions.extend(self._consume_event(action["event"]))
            else:
                io_actions.append(action)
        target = self.store.take_metadata_request()
        if target and not self.fixture:
            self._dispatch(self.session.request_metadata(target, "job"), io)
        follow = self._follow_directory
        self._follow_directory = False
        for action in io_actions:
            io(action)
        if follow and not self.fixture:
            self._dispatch(self.session.request_directory(self.store.directory_relative), io)


def _axes(text: str) -> list[str]:
    cleaned = (text or "").lower().strip()
    if cleaned in ("", "all", "xyz"):
        return ["x", "y", "z"]
    return [axis for axis in ("x", "y", "z") if axis in cleaned]


def _ok_text(event: dict) -> str:
    text = event.get("summary") or "Done"
    note = event.get("note")
    if note:
        return f"{text}. {note}"
    return text
