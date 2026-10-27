"""Glue between the Moonraker session, the store, and preferences.

No Qt imports. The GUI and the tests both drive this object.
"""

from __future__ import annotations

from layr_qt.moonraker.session import MoonrakerSession
from layr_qt.preferences import parse_preferences, sanitize_display_name
from layr_qt.moonraker.urls import validate_moonraker_url
from layr_qt.store import PrinterStore
from layr_qt.viewmodel import PAGES


class Controller:
    def __init__(self, session: MoonrakerSession, store: PrinterStore, prefs: dict) -> None:
        self.session = session
        self.store = store
        self.prefs = parse_preferences(prefs)
        self.page = "home"
        self.settings_error = ""
        self.dimmed = False
        self.fixture = False

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
        self._dispatch(self.session.on_timer(name), io)

    def open_page(self, page: str, io) -> None:
        if page not in PAGES:
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

    def _dispatch(self, actions: list[dict], io) -> None:
        io_actions = []
        for action in actions:
            if action.get("kind") == "event":
                self.store.apply(action["event"])
            else:
                io_actions.append(action)
        target = self.store.take_metadata_request()
        if target:
            self._dispatch(self.session.request_metadata(target, "job"), io)
        for action in io_actions:
            io(action)
