"""Qt Quick bridge. Imported only when the window is launched."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import unquote

from PyQt6.QtCore import QEvent, QObject, QTimer, QUrl, pyqtProperty, pyqtSignal, pyqtSlot
from PyQt6.QtGui import QColor, QImage, QLinearGradient, QPainter
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest
from PyQt6.QtQuick import QQuickImageProvider
from PyQt6.QtWebSockets import QWebSocket

from layr_qt.controller import Controller
from layr_qt.moonraker.files import MAX_THUMBNAIL_BYTES, image_kind, thumbnail_request_url
from layr_qt.moonraker.urls import oneshot_token_url, websocket_url
from layr_qt.perf import PerfTracker, append_perf_log
from layr_qt.preferences import save_preferences
from layr_qt.viewmodel import build_view

log = logging.getLogger("layr_qt")


class ThumbProvider(QQuickImageProvider):
    def __init__(self) -> None:
        super().__init__(QQuickImageProvider.ImageType.Image)
        self.images: dict[str, QImage] = {}
        self.token = 0

    def put(self, key: str, image: QImage) -> int:
        self.images[key] = image
        self.token += 1
        return self.token

    def requestImage(self, image_id, requestedSize):  # noqa: N802 - Qt API
        key = unquote((image_id or "").split("?", 1)[0])
        image = self.images.get(key)
        if image is None or image.isNull():
            image = QImage(2, 2, QImage.Format.Format_ARGB32)
            image.fill(QColor(0, 0, 0, 0))
        return image, image.size()


class Bridge(QObject):
    viewChanged = pyqtSignal()
    thumbChanged = pyqtSignal()

    def __init__(self, font_family: str) -> None:
        super().__init__()
        self._view = "{}"
        self._token = 0
        self._font = font_family
        self.runtime = None

    def attach(self, runtime) -> None:
        self.runtime = runtime

    @pyqtProperty(str, notify=viewChanged)
    def viewJson(self) -> str:
        return self._view

    @pyqtProperty(int, notify=thumbChanged)
    def thumbToken(self) -> int:
        return self._token

    @pyqtProperty(str, constant=True)
    def fontFamily(self) -> str:
        return self._font

    def set_view(self, text: str) -> None:
        if text != self._view:
            self._view = text
            self.viewChanged.emit()

    def set_thumb_token(self, token: int) -> None:
        self._token = token
        self.thumbChanged.emit()

    @pyqtSlot(str)
    def openPage(self, page: str) -> None:
        if self.runtime:
            self.runtime.open_page(page)

    @pyqtSlot(str)
    def openDirectory(self, path: str) -> None:
        if self.runtime:
            self.runtime.open_directory(path)

    @pyqtSlot(str)
    def selectFile(self, path: str) -> None:
        if self.runtime:
            self.runtime.select_file(path)

    @pyqtSlot(str, str, str, bool, int)
    def saveSettings(self, name: str, url: str, theme: str, hide_cursor: bool, dim_minutes: int) -> None:
        if self.runtime:
            self.runtime.save_settings(name, url, theme, hide_cursor, dim_minutes)

    @pyqtSlot()
    def reconnect(self) -> None:
        if self.runtime:
            self.runtime.reconnect()

    @pyqtSlot()
    def wake(self) -> None:
        if self.runtime:
            self.runtime.wake()

    @pyqtSlot(str)
    def home(self, axes: str) -> None:
        self._command(lambda io: self.runtime.controller.home(axes, io))

    @pyqtSlot(str, float, float)
    def jog(self, axis: str, distance: float, speed: float) -> None:
        self._command(lambda io: self.runtime.controller.jog(axis, distance, speed, io))

    @pyqtSlot(float)
    def babyStep(self, delta: float) -> None:  # noqa: N802 - QML name
        self._command(lambda io: self.runtime.controller.baby_step(delta, io))

    @pyqtSlot()
    def motorsOff(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.motors_off(io))

    @pyqtSlot(str, float)
    def setHeater(self, heater: str, target: float) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.set_heater(heater, target, io))

    @pyqtSlot(str, float)
    def setFan(self, fan: str, speed: float) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.set_fan(fan, speed, io))

    @pyqtSlot(str, float)
    def setLight(self, light: str, value: float) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.set_light(light, value, io))

    @pyqtSlot(float, float)
    def extrude(self, length: float, speed: float) -> None:
        self._command(lambda io: self.runtime.controller.extrude(length, speed, io))

    @pyqtSlot(str)
    def runMacro(self, name: str) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.run_macro(name, io))

    @pyqtSlot(str)
    def consoleSend(self, script: str) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.console_send(script, io))

    @pyqtSlot()
    def pausePrint(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.pause(io))

    @pyqtSlot()
    def resumePrint(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.resume(io))

    @pyqtSlot()
    def cancelPrint(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.cancel(io))

    @pyqtSlot(str)
    def startPrint(self, filename: str) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.start_print(filename, io))

    @pyqtSlot(str)
    def deleteFile(self, path: str) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.delete_file(path, io))

    @pyqtSlot()
    def emergencyStop(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.emergency_stop(io))

    @pyqtSlot()
    def restartKlipper(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.restart_klipper(io))

    @pyqtSlot()
    def firmwareRestart(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.firmware_restart(io))

    @pyqtSlot(float)
    def setSpeedFactor(self, percent: float) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.set_speed_factor(percent, io))

    @pyqtSlot(float)
    def setExtrudeFactor(self, percent: float) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.set_extrude_factor(percent, io))

    @pyqtSlot()
    def confirmPending(self) -> None:  # noqa: N802
        self._command(lambda io: self.runtime.controller.confirm_pending(io))

    @pyqtSlot()
    def dismissPending(self) -> None:  # noqa: N802
        if self.runtime:
            self.runtime.controller.dismiss_pending()
            self.runtime.publish()

    @pyqtSlot()
    def dismissToast(self) -> None:  # noqa: N802
        if self.runtime:
            self.runtime.controller.dismiss_toast()
            self.runtime.publish()

    @pyqtSlot()
    def toggleHidden(self) -> None:  # noqa: N802
        if self.runtime:
            self.runtime.controller.toggle_hidden()
            self.runtime.publish()

    def _command(self, fn) -> None:
        if self.runtime:
            self.runtime.command(fn)


class PressFilter(QObject):
    def __init__(self, runtime) -> None:
        super().__init__()
        self.runtime = runtime

    def eventFilter(self, watched, event) -> bool:  # noqa: N802 - Qt API
        kind = event.type()
        if kind in (QEvent.Type.MouseButtonPress, QEvent.Type.TouchBegin):
            self.runtime.note_pointer()
        elif kind in (QEvent.Type.KeyPress, QEvent.Type.Wheel):
            self.runtime.note_activity()
        return False


class QtRuntime(QObject):
    def __init__(self, controller: Controller, bridge: Bridge, perf: PerfTracker, provider: ThumbProvider, prefs_path: Path, perf_log: Path | None) -> None:
        super().__init__()
        self.controller = controller
        self.bridge = bridge
        self.perf = perf
        self.provider = provider
        self.prefs_path = prefs_path
        self.perf_log = perf_log
        self.nam = QNetworkAccessManager(self)
        self.ws: QWebSocket | None = None
        self.timers: dict[str, QTimer] = {}
        self._depth = 0
        self._thumb_key = ""
        self._thumb_reply: QNetworkReply | None = None
        self._token_reply: QNetworkReply | None = None
        self.app = None
        self.window = None
        self._cursor_hidden: bool | None = None
        self.idle = QTimer(self)
        self.idle.setSingleShot(True)
        self.idle.timeout.connect(self._dim)
        self.sample = QTimer(self)
        self.sample.setInterval(2000)
        self.sample.timeout.connect(self._sample_proc)

    def start(self) -> None:
        self._arm_idle()
        if not self.controller.fixture:
            self.sample.start()
            self._wrap(lambda: self.controller.start(self._io))
        else:
            self.publish()

    def publish(self) -> None:
        perf = self.perf.snapshot() if not self.controller.fixture else {
            "startupMs": None,
            "rssMb": None,
            "cpuPercent": None,
            "touchMs": None,
            "touchP50Ms": None,
            "note": "Fixture data. Not a Pi measurement and not a Chromium comparison.",
        }
        view = build_view(
            self.controller.store,
            self.controller.prefs,
            now_ms=time.time() * 1000,
            perf=perf,
            page=self.controller.page,
            dimmed=self.controller.dimmed,
            settings_error=self.controller.settings_error,
            fixture=self.controller.fixture,
            ui=self.controller.ui_state(),
        )
        self._apply_cursor(bool(view["hideCursor"]))
        self.bridge.set_view(json.dumps(view, separators=(",", ":")))
        self._sync_thumbnail(view["job"].get("thumbnailKey") or "")
        if self.perf_log and not self.controller.fixture:
            try:
                append_perf_log(self.perf_log, perf)
            except OSError:
                log.warning("Could not write the performance log")

    def open_page(self, page: str) -> None:
        self._wrap(lambda: self.controller.open_page(page, self._io))

    def open_directory(self, path: str) -> None:
        self._wrap(lambda: self.controller.open_directory(path, self._io))

    def select_file(self, path: str) -> None:
        self._wrap(lambda: self.controller.select_file(path, self._io))

    def save_settings(self, name: str, url: str, theme: str, hide_cursor: bool, dim_minutes: int) -> None:
        previous = self.controller.prefs["moonrakerUrl"]
        result = self.controller.save_settings(name, url, theme, hide_cursor, dim_minutes)
        if result is not None:
            try:
                save_preferences(self.prefs_path, self.controller.prefs)
            except OSError:
                self.controller.settings_error = "Could not save preferences on this machine."
            self._arm_idle()
            if result["urlChanged"] and not self.controller.fixture:
                self._wrap(lambda: self.controller.reconnect(self._io))
                return
        if result is None and previous:
            pass
        self.publish()

    def reconnect(self) -> None:
        self._wrap(lambda: self.controller.reconnect(self._io))

    def wake(self) -> None:
        self.controller.wake()
        self._arm_idle()
        self.publish()

    def command(self, fn) -> None:
        self._wrap(lambda: fn(self._io))

    def note_pointer(self) -> None:
        self.perf.note_press(time.monotonic())
        self.note_activity()

    def note_activity(self) -> None:
        if self.controller.dimmed:
            self.controller.wake()
            self.publish()
        self._arm_idle()

    def note_frame(self) -> None:
        self.perf.note_frame(time.monotonic())

    def _dim(self) -> None:
        if self.controller.prefs.get("dimAfterMinutes"):
            self.controller.dimmed = True
            self.publish()

    def _arm_idle(self) -> None:
        minutes = self.controller.prefs.get("dimAfterMinutes") or 0
        if minutes:
            self.idle.start(int(minutes) * 60 * 1000)
        else:
            self.idle.stop()

    def _sample_proc(self) -> None:
        try:
            status = Path("/proc/self/status").read_text(encoding="utf-8")
            stat = Path("/proc/self/stat").read_text(encoding="utf-8")
        except OSError:
            return
        self.perf.note_proc(status, stat, time.monotonic(), os.sysconf("SC_CLK_TCK"))
        self.publish()

    def _wrap(self, fn) -> None:
        self._depth += 1
        try:
            fn()
        finally:
            self._depth -= 1
            if self._depth == 0:
                self.publish()

    def _io(self, action: dict) -> None:
        kind = action.get("kind")
        if kind == "connect":
            self._begin_socket()
        elif kind == "send":
            if self.ws is not None:
                self.ws.sendTextMessage(action["text"])
            if action.get("armRpcTimeoutMs"):
                self._arm("rpc", action["armRpcTimeoutMs"])
        elif kind == "close":
            self._detach_socket()
        elif kind == "timer":
            self._arm(action["name"], action["ms"])
        elif kind == "cancel_timer":
            timer = self.timers.get(action["name"])
            if timer is not None:
                timer.stop()
        elif kind == "cancel_timers":
            for timer in self.timers.values():
                timer.stop()

    def _arm(self, name: str, ms: int) -> None:
        timer = self.timers.get(name)
        if timer is None:
            timer = QTimer(self)
            timer.setSingleShot(True)
            timer.timeout.connect(lambda n=name: self._wrap(lambda: self.controller.on_timer(n, self._io)))
            self.timers[name] = timer
        timer.start(max(0, int(ms)))

    def _begin_socket(self) -> None:
        base = self.controller.prefs["moonrakerUrl"]
        api_key = os.environ.get("LAYR_QT_API_KEY", "").strip()
        if not api_key:
            self._open_socket(None)
            return
        url = oneshot_token_url(base)
        if url is None:
            self._wrap(lambda: self.controller.on_connect_failed("Moonraker URL is not valid", self._io))
            return
        request = QNetworkRequest(QUrl(url))
        request.setRawHeader(b"X-Api-Key", api_key.encode("utf-8"))
        request.setAttribute(
            QNetworkRequest.Attribute.RedirectPolicyAttribute,
            QNetworkRequest.RedirectPolicy.ManualRedirectPolicy,
        )
        reply = self.nam.get(request)
        self._token_reply = reply
        reply.finished.connect(lambda r=reply: self._token_finished(r))

    def _token_finished(self, reply: QNetworkReply) -> None:
        if reply is not self._token_reply:
            reply.deleteLater()
            return
        self._token_reply = None
        status = reply.attribute(QNetworkRequest.Attribute.HttpStatusCodeAttribute)
        body = bytes(reply.readAll())
        reply.deleteLater()
        if status in (401, 403):
            self._wrap(lambda: self.controller.on_connect_failed("Moonraker refused the API key. Prefer trusted_clients for 127.0.0.1.", self._io))
            return
        token = None
        try:
            payload = json.loads(body.decode("utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("result"), str):
                token = payload["result"]
        except (UnicodeDecodeError, json.JSONDecodeError):
            token = None
        if not token:
            self._wrap(lambda: self.controller.on_connect_failed("Moonraker did not return a oneshot token", self._io))
            return
        self._open_socket(token)

    def _open_socket(self, token: str | None) -> None:
        url = websocket_url(self.controller.prefs["moonrakerUrl"], token)
        if url is None:
            self._wrap(lambda: self.controller.on_connect_failed("Moonraker URL is not valid", self._io))
            return
        self._detach_socket()
        socket = QWebSocket()
        socket.setMaxAllowedIncomingMessageSize(8 * 1024 * 1024)
        socket.connected.connect(lambda: self._wrap(lambda: self.controller.on_open(self._io)))
        socket.disconnected.connect(self._on_disconnected)
        socket.textMessageReceived.connect(lambda text: self._wrap(lambda: self.controller.on_message(text, self._io)))
        socket.error.connect(self._on_socket_error)
        self.ws = socket
        log.info("Connecting to Moonraker")
        socket.open(QUrl(url))

    def _on_socket_error(self, *_args) -> None:
        if self.ws is not None:
            message = self.ws.errorString() or "Socket error"
            log.warning("Moonraker socket error: %s", message)

    def _on_disconnected(self) -> None:
        if self.sender() is not self.ws:
            return
        reason = "Connection closed"
        if self.ws is not None and self.ws.errorString():
            reason = self.ws.errorString()
        log.info("Moonraker connection closed")
        self._wrap(lambda: self.controller.on_close(reason, self._io))

    def _detach_socket(self) -> None:
        socket = self.ws
        self.ws = None
        if socket is None:
            return
        socket.blockSignals(True)
        socket.close()
        socket.deleteLater()

    def _sync_thumbnail(self, key: str) -> None:
        if not key or key == self._thumb_key or key in self.provider.images:
            if key in self.provider.images and self.provider.token:
                self.bridge.set_thumb_token(self.provider.token)
            return
        url = thumbnail_request_url(self.controller.prefs["moonrakerUrl"], key)
        if url is None:
            return
        self._thumb_key = key
        request = QNetworkRequest(QUrl(url))
        request.setAttribute(
            QNetworkRequest.Attribute.RedirectPolicyAttribute,
            QNetworkRequest.RedirectPolicy.ManualRedirectPolicy,
        )
        reply = self.nam.get(request)
        self._thumb_reply = reply
        reply.finished.connect(lambda r=reply, wanted=key: self._thumb_finished(r, wanted))

    def _thumb_finished(self, reply: QNetworkReply, key: str) -> None:
        data = bytes(reply.readAll())
        reply.deleteLater()
        if reply is self._thumb_reply:
            self._thumb_reply = None
        if image_kind(data) is None or len(data) > MAX_THUMBNAIL_BYTES:
            log.info("Thumbnail skipped (not a png or jpeg, or too large)")
            return
        image = QImage()
        if not image.loadFromData(data):
            return
        token = self.provider.put(key, image)
        self.bridge.set_thumb_token(token)

    def _apply_cursor(self, hide: bool) -> None:
        if self.app is None or hide == self._cursor_hidden:
            return
        from PyQt6.QtCore import Qt
        from PyQt6.QtGui import QCursor

        while self.app.overrideCursor() is not None:
            self.app.restoreOverrideCursor()
        if hide:
            self.app.setOverrideCursor(QCursor(Qt.CursorShape.BlankCursor))
        self._cursor_hidden = hide


def paint_fixture_thumbnail(provider: ThumbProvider) -> None:
    image = QImage(300, 300, QImage.Format.Format_RGB32)
    painter = QPainter(image)
    painter.fillRect(0, 0, 300, 300, QColor("#171b24"))
    gradient = QLinearGradient(70, 40, 230, 250)
    gradient.setColorAt(0, QColor("#3ee0f0"))
    gradient.setColorAt(1, QColor("#8b6cff"))
    painter.setBrush(gradient)
    painter.setPen(QColor("#0a0c11"))
    painter.drawRoundedRect(58, 48, 184, 204, 28, 28)
    painter.end()
    provider.put("jobs/.thumbs/voron_cube-300x300.png", image)
