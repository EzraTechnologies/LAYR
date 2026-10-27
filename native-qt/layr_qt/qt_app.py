"""Qt Quick shell. Imported only when the UI is launched."""

from __future__ import annotations

import argparse
import asyncio
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

from . import __version__
from .fixture import fixture_model, rgb_png
from .machine import MoonrakerMachine
from .perf import PerfLog
from .preferences import Preferences, clean_display_name, load_preferences, save_preferences, state_dir
from .session import Session, oneshot_token_request, parse_oneshot
from .urls import is_valid_moonraker_url, redact_url
from .viewmodel import ViewModel

QML_DIR = Path(__file__).resolve().parent.parent / "qml"
PAGES = ("home", "files", "controls", "settings")


def run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="LAYR native Qt prototype (read-only).")
    parser.add_argument("--moonraker", help="Moonraker base URL. Overrides the saved preference for this launch.")
    parser.add_argument("--size", help="Window size, for example 1024x600 or 800x480.")
    parser.add_argument("--screenshot", metavar="DIR", help="Grab fixture screenshots with the offscreen platform and exit.")
    parser.add_argument("--version", action="store_true")
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0

    screenshot = Path(args.screenshot) if args.screenshot else None
    if screenshot is not None:
        os.environ["QT_QPA_PLATFORM"] = "offscreen"
        os.environ["QT_QUICK_BACKEND"] = "software"
    os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "0")
    os.environ.setdefault("QT_QUICK_CONTROLS_STYLE", "Basic")

    loaded = _load_qt()
    if loaded is None:
        print(
            "Qt Quick for Python is not installed. Debian 12 has PyQt6 (python3-pyqt6.qtquick). "
            "PySide6 is not in bookworm. Run native-qt/check-deps.sh.",
            file=sys.stderr,
        )
        return 2
    QObject = loaded["QObject"]
    Qt = loaded["Qt"]
    QTimer = loaded["QTimer"]
    QUrl = loaded["QUrl"]
    Signal = loaded["Signal"]
    Slot = loaded["Slot"]
    Property = loaded["Property"]
    QColor = loaded["QColor"]
    QCursor = loaded["QCursor"]
    QFont = loaded["QFont"]
    QFontDatabase = loaded["QFontDatabase"]
    QGuiApplication = loaded["QGuiApplication"]
    QPalette = loaded["QPalette"]
    QQmlApplicationEngine = loaded["QQmlApplicationEngine"]

    perf = PerfLog(None if screenshot else state_dir() / "perf.jsonl")
    perf.mark("process_start", version=__version__)
    prefs = load_preferences()
    if args.moonraker is not None:
        if args.moonraker.strip() and not is_valid_moonraker_url(args.moonraker):
            print("Invalid Moonraker URL.", file=sys.stderr)
            return 2
        prefs.moonraker_url = args.moonraker.strip()
    if args.size:
        parsed = _parse_size(args.size)
        if parsed is None:
            print("Size must look like 1024x600.", file=sys.stderr)
            return 2
        prefs.width, prefs.height = parsed
    if screenshot is not None:
        prefs.display_name = "Trident"
        prefs.moonraker_url = "http://localhost:7125"
        prefs.theme = "midnight"

    model = fixture_model() if screenshot else ViewModel(prefs.display_name, prefs.moonraker_url)
    app = QGuiApplication([sys.argv[0]])
    _apply_palette(app, QPalette, QColor)
    families = set(QFontDatabase.families())
    app.setFont(QFont("Inter" if "Inter" in families else "DejaVu Sans"))
    perf.mark("qt_app_created")
    from .bridge import Bridge

    inbox: queue.SimpleQueue[tuple[str, Any]] = queue.SimpleQueue()
    bridge = Bridge(prefs, model, perf, inbox, screenshot is not None)
    if screenshot is not None:
        thumb = state_dir() / "fixture-thumb.png"
        thumb.parent.mkdir(parents=True, exist_ok=True)
        thumb.write_bytes(rgb_png(96, 96, (62, 224, 240)))
        bridge._thumb = thumb.resolve().as_uri()

    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty("bridge", bridge)

    def _warnings(warnings) -> None:
        for item in warnings:
            print(f"[layr-qt] qml: {item.toString()}", file=sys.stderr)

    engine.warnings.connect(_warnings)
    engine.load(QUrl.fromLocalFile(str(QML_DIR / "Main.qml")))
    if not engine.rootObjects():
        print("QML failed to load. Check that qml6-module-qtquick-controls is installed.", file=sys.stderr)
        return 1
    window = _as_quick_window(engine.rootObjects()[0])
    bridge.attach_window(window)
    window.frameSwapped.connect(bridge.note_frame)
    perf.mark("qml_loaded")

    if screenshot is not None:
        screenshot.mkdir(parents=True, exist_ok=True)
        _grab(app, window, bridge, screenshot)
        perf.mark("screenshots_written")
        return 0

    api_key = os.environ.get("LAYR_QT_API_KEY", "").strip() or None
    service: ServiceThread | None = None
    if prefs.moonraker_url:
        service = ServiceThread(model, prefs.moonraker_url, api_key, inbox, perf)
        bridge.attach_service(service)
        service.start()
    else:
        inbox.put(("state", model.snapshot()))

    timer = QTimer()
    timer.timeout.connect(bridge.drain)
    timer.start(50)
    bridge.drain()
    try:
        code = app.exec()
    finally:
        if service is not None:
            service.stop()
        perf.flush_summary()
    return int(code)


class ServiceThread(threading.Thread):
    def __init__(
        self,
        model: ViewModel,
        base_url: str,
        api_key: str | None,
        inbox: queue.SimpleQueue[tuple[str, Any]],
        perf: PerfLog,
    ) -> None:
        super().__init__(name="layr-qt-moonraker", daemon=True)
        self.perf = perf
        self._marked = False
        machine = MoonrakerMachine(base_url)

        def publish(snapshot: dict[str, Any]) -> None:
            if snapshot.get("connected") and not self._marked:
                self._marked = True
                perf.mark("moonraker_connected")
            inbox.put(("state", snapshot))

        self.session = Session(
            machine,
            model,
            connect=lambda url: _connect_websocket(url, api_key),
            publish=publish,
            publish_files=lambda payload: inbox.put(("files", payload)),
            publish_thumbnail=lambda data: inbox.put(("thumb", data)),
            now=time.monotonic,
            api_key=api_key,
            log=lambda line: print(f"[layr-qt] {line}", file=sys.stderr),
        )

    def run(self) -> None:
        try:
            asyncio.run(self.session.run())
        except Exception as exc:
            print(f"[layr-qt] Moonraker session stopped: {exc}", file=sys.stderr)

    def submit(self, command: tuple[Any, ...]) -> None:
        self.session.submit(command)

    def stop(self) -> None:
        self.session.submit(("stop",))
        self.join(timeout=3)


async def _connect_websocket(url: str, api_key: str | None):
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("python3-websockets is not installed") from exc

    target = url
    if api_key:
        token = await asyncio.to_thread(_fetch_token, url, api_key)
        sep = "&" if "?" in target else "?"
        target = f"{target}{sep}token={quote(token)}"
    print(f"[layr-qt] connecting {redact_url(target)}", file=sys.stderr)
    return await websockets.connect(target, open_timeout=10, max_size=8_000_000)


def _fetch_token(ws_url: str, api_key: str) -> str:
    from .urls import normalise_base_url

    base = normalise_base_url(ws_url.replace("wss://", "https://").replace("ws://", "http://"))
    url, headers = oneshot_token_request(base, api_key)
    request = Request(url, headers=headers)
    with urlopen(request, timeout=10) as response:
        return parse_oneshot(response.read().decode("utf-8"))


def _load_qt() -> dict[str, Any] | None:
    """Debian 12 has PyQt6. PySide6 arrives in Debian 13, so either binding is accepted."""
    try:
        from PyQt6.QtCore import QObject, Qt, QTimer, QUrl, pyqtProperty, pyqtSignal, pyqtSlot
        from PyQt6.QtGui import QColor, QCursor, QFont, QFontDatabase, QGuiApplication, QPalette
        from PyQt6.QtQml import QQmlApplicationEngine

        return {
            "binding": "PyQt6",
            "QObject": QObject,
            "Qt": Qt,
            "QTimer": QTimer,
            "QUrl": QUrl,
            "Signal": pyqtSignal,
            "Slot": pyqtSlot,
            "Property": pyqtProperty,
            "QColor": QColor,
            "QCursor": QCursor,
            "QFont": QFont,
            "QFontDatabase": QFontDatabase,
            "QGuiApplication": QGuiApplication,
            "QPalette": QPalette,
            "QQmlApplicationEngine": QQmlApplicationEngine,
        }
    except ImportError:
        pass
    try:
        from PySide6.QtCore import Property, QObject, Qt, QTimer, QUrl, Signal, Slot
        from PySide6.QtGui import QColor, QCursor, QFont, QFontDatabase, QGuiApplication, QPalette
        from PySide6.QtQml import QQmlApplicationEngine
    except ImportError:
        return None
    return {
        "binding": "PySide6",
        "QObject": QObject,
        "Qt": Qt,
        "QTimer": QTimer,
        "QUrl": QUrl,
        "Signal": Signal,
        "Slot": Slot,
        "Property": Property,
        "QColor": QColor,
        "QCursor": QCursor,
        "QFont": QFont,
        "QFontDatabase": QFontDatabase,
        "QGuiApplication": QGuiApplication,
        "QPalette": QPalette,
        "QQmlApplicationEngine": QQmlApplicationEngine,
    }


def _parse_size(value: str) -> tuple[int, int] | None:
    if "x" not in value.lower():
        return None
    width, _, height = value.lower().partition("x")
    try:
        parsed = (int(width), int(height))
    except ValueError:
        return None
    if parsed[0] < 640 or parsed[1] < 400:
        return None
    return parsed


def _apply_palette(app, palette_type, color) -> None:  # type: ignore[no-untyped-def]
    palette = palette_type()
    palette.setColor(palette_type.ColorRole.Window, color("#0a0c11"))
    palette.setColor(palette_type.ColorRole.WindowText, color("#e9edf5"))
    palette.setColor(palette_type.ColorRole.Base, color("#171b24"))
    palette.setColor(palette_type.ColorRole.Text, color("#e9edf5"))
    palette.setColor(palette_type.ColorRole.Button, color("#1e2330"))
    palette.setColor(palette_type.ColorRole.ButtonText, color("#e9edf5"))
    palette.setColor(palette_type.ColorRole.Highlight, color("#3ee0f0"))
    app.setPalette(palette)


def _as_quick_window(window):
    try:
        from PyQt6.QtQuick import QQuickWindow
        from PyQt6 import sip
    except ImportError:
        from PySide6.QtQuick import QQuickWindow

        return window if isinstance(window, QQuickWindow) else window
    if isinstance(window, QQuickWindow):
        return window
    return sip.cast(window, QQuickWindow)


def _grab(app, window, bridge, outdir: Path) -> None:
    pages = ("home", "files", "controls", "settings")
    sizes = ((1024, 600), (800, 480))
    for width, height in sizes:
        window.setWidth(width)
        window.setHeight(height)
        for page in pages:
            bridge._page = page
            bridge.pageChanged.emit()
            for _ in range(10):
                app.processEvents()
                time.sleep(0.03)
            image = window.grabWindow()
            target = outdir / f"{width}x{height}-{page}.png"
            if image.isNull() or not image.save(str(target)):
                raise RuntimeError(f"Could not grab {target.name}. The offscreen platform plugin may be missing.")
            print(f"wrote {target}")
