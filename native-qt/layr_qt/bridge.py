"""QObject exposed to QML. Module-level so PyQt6 will publish its properties."""

from __future__ import annotations

import queue

from .preferences import clean_display_name, save_preferences, state_dir
from .urls import is_valid_moonraker_url

try:
    from PyQt6.QtCore import QObject, Qt, pyqtProperty, pyqtSignal, pyqtSlot
    from PyQt6.QtGui import QCursor, QGuiApplication
except ImportError:  # Debian 13 / a pip install may have PySide6 instead.
    from PySide6.QtCore import Property as pyqtProperty
    from PySide6.QtCore import QObject, Qt, Signal as pyqtSignal, Slot as pyqtSlot
    from PySide6.QtGui import QCursor, QGuiApplication

PAGES = ("home", "files", "controls", "settings")


class Bridge(QObject):
    stateChanged = pyqtSignal()
    filesChanged = pyqtSignal()
    pageChanged = pyqtSignal()
    thumbnailChanged = pyqtSignal()
    prefsChanged = pyqtSignal()
    noticeChanged = pyqtSignal()

    def __init__(self, prefs, model, perf, inbox: queue.SimpleQueue, fixture: bool) -> None:
        super().__init__()
        self._prefs = prefs
        self._model = model
        self._perf = perf
        self._inbox = inbox
        self._fixture = fixture
        self._state = model.snapshot()
        self._files = model.files_snapshot()
        self._page = "home"
        self._thumb = ""
        self._rev = 0
        self._message = "Fixture data — not a live printer" if fixture else ""
        self._error = ""
        self._window = None
        self._service = None
        self._cursor_hidden = False
        self._saw_frame = False

    def attach_window(self, window) -> None:
        self._window = window
        self.apply_cursor(self._prefs.hide_cursor)
        if not self._fixture:
            window.setWidth(self._prefs.width)
            window.setHeight(self._prefs.height)

    def attach_service(self, service) -> None:
        self._service = service

    def set_thumbnail_file(self, url: str) -> None:
        self._thumb = url
        self.thumbnailChanged.emit()

    def drain(self) -> None:
        state = None
        files = None
        thumb: tuple[bool, bytes | None] = (False, None)
        while True:
            try:
                kind, payload = self._inbox.get_nowait()
            except queue.Empty:
                break
            if kind == "state":
                state = payload
            elif kind == "files":
                files = payload
            elif kind == "thumb":
                thumb = (True, payload)
        if state is not None:
            self._state = state
            self.stateChanged.emit()
        if files is not None:
            self._files = files
            self.filesChanged.emit()
        if thumb[0]:
            self._write_thumb(thumb[1])

    def note_frame(self) -> None:
        if not self._saw_frame:
            self._saw_frame = True
            self._perf.mark("first_frame")
        self._perf.frame()

    def _write_thumb(self, data: bytes | None) -> None:
        if not data:
            self._thumb = ""
            self.thumbnailChanged.emit()
            return
        self._rev += 1
        suffix = "png" if data.startswith(b"\x89PNG") else "jpg"
        path = state_dir() / f"thumb-{self._rev}.{suffix}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self._thumb = path.resolve().as_uri()
        self.thumbnailChanged.emit()

    @pyqtProperty("QVariantMap", notify=stateChanged)
    def state(self):
        return self._state

    @pyqtProperty("QVariantMap", notify=filesChanged)
    def files(self):
        return self._files

    @pyqtProperty(str, notify=pageChanged)
    def page(self) -> str:
        return self._page

    @pyqtProperty(str, notify=thumbnailChanged)
    def thumbnailUrl(self) -> str:
        return self._thumb

    @pyqtProperty(str, notify=prefsChanged)
    def themeName(self) -> str:
        return self._prefs.theme

    @pyqtProperty(bool, notify=prefsChanged)
    def hideCursor(self) -> bool:
        return self._prefs.hide_cursor

    @pyqtProperty(str, notify=prefsChanged)
    def moonrakerUrl(self) -> str:
        return self._prefs.moonraker_url

    @pyqtProperty(str, notify=prefsChanged)
    def displayName(self) -> str:
        return self._prefs.display_name

    @pyqtProperty(str, notify=noticeChanged)
    def notice(self) -> str:
        return self._message

    @pyqtProperty(str, notify=noticeChanged)
    def formError(self) -> str:
        return self._error

    @pyqtProperty(bool, constant=True)
    def fixtureMode(self) -> bool:
        return self._fixture

    @pyqtProperty(str, constant=True)
    def perfPath(self) -> str:
        return "" if self._perf.path is None else str(self._perf.path)

    @pyqtSlot(str)
    def openPage(self, page: str) -> None:
        if page not in PAGES:
            return
        self._page = page
        self.pageChanged.emit()
        self._perf.press(f"nav-{page}")
        if page == "files" and self._service is not None:
            self._service.submit(("directory", str(self._files.get("directory") or "")))

    @pyqtSlot(str)
    def openDirectory(self, path: str) -> None:
        self._perf.press("files-open")
        if self._service is not None:
            self._service.submit(("directory", path))

    @pyqtSlot()
    def openParent(self) -> None:
        current = str(self._files.get("directory") or "")
        parent = current.rsplit("/", 1)[0] if "/" in current else ""
        self.openDirectory(parent)

    @pyqtSlot(str, str)
    def saveSettings(self, url: str, name: str) -> None:
        trimmed = url.strip()
        if trimmed and not is_valid_moonraker_url(trimmed):
            self._error = "Use an http, https, ws, or wss URL without a username or password."
            self._message = ""
            self.noticeChanged.emit()
            return
        self._prefs.moonraker_url = trimmed
        self._prefs.display_name = clean_display_name(name)
        self._error = ""
        self._message = "Saved on this screen. The Linux hostname was not changed."
        if not self._fixture:
            save_preferences(self._prefs)
        self.prefsChanged.emit()
        self.noticeChanged.emit()
        if self._service is None:
            self._model.display_name = self._prefs.display_name
            self._model.moonraker_url = trimmed
            self._state = self._model.snapshot()
            self.stateChanged.emit()
            return
        self._service.submit(("rename", self._prefs.display_name))
        self._service.submit(("url", trimmed))

    @pyqtSlot()
    def reconnect(self) -> None:
        self._perf.press("reconnect")
        if self._service is not None:
            self._service.submit(("reconnect",))

    @pyqtSlot(bool)
    def setHideCursor(self, hide: bool) -> None:
        self._prefs.hide_cursor = bool(hide)
        if not self._fixture:
            save_preferences(self._prefs)
        self.apply_cursor(self._prefs.hide_cursor)
        self.prefsChanged.emit()

    @pyqtSlot(str)
    def setTheme(self, theme: str) -> None:
        if theme not in {"midnight", "black"}:
            return
        self._prefs.theme = theme
        if not self._fixture:
            save_preferences(self._prefs)
        self.prefsChanged.emit()

    @pyqtSlot(int, int)
    def resizeTo(self, width: int, height: int) -> None:
        if self._window is not None:
            self._window.setWidth(width)
            self._window.setHeight(height)
        self._prefs.width = width
        self._prefs.height = height
        if not self._fixture:
            save_preferences(self._prefs)

    @pyqtSlot(str)
    def notePress(self, control: str) -> None:
        self._perf.press(str(control)[:80])

    def apply_cursor(self, hide: bool) -> None:
        application = QGuiApplication.instance()
        if application is None:
            return
        if hide and not self._cursor_hidden:
            application.setOverrideCursor(QCursor(Qt.CursorShape.BlankCursor))
            self._cursor_hidden = True
        elif not hide and self._cursor_hidden:
            application.restoreOverrideCursor()
            self._cursor_hidden = False
