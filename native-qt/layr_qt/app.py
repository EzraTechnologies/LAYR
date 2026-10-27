"""Entry point for the native Qt Quick prototype."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import tempfile
import time
from pathlib import Path

from layr_qt import __version__
from layr_qt.controller import Controller
from layr_qt.fixture import apply_fixture, fixture_preferences
from layr_qt.moonraker.session import MoonrakerSession
from layr_qt.moonraker.urls import validate_moonraker_url
from layr_qt.preferences import default_preferences_path, load_preferences, parse_preferences
from layr_qt.store import PrinterStore

QML_DIR = Path(__file__).resolve().parent.parent / "qml"
FIXTURES = ("printing", "ready", "offline", "files", "controls", "settings")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="layr-qt", description="Read-only native Qt Quick LAYR prototype.")
    parser.add_argument("--geometry", default="1024x600", help="Window size, for example 1024x600 or 800x480")
    parser.add_argument("--fullscreen", action="store_true", help="Fullscreen in the current session. Does not stop another display.")
    parser.add_argument("--platform", default="", help="Qt platform plugin name, for example wayland or xcb")
    parser.add_argument("--moonraker", default="", help="Session Moonraker URL. Not written until you tap Save.")
    parser.add_argument("--config", default="", help="Preferences JSON path")
    parser.add_argument("--page", default="", choices=["", "home", "files", "controls", "settings"])
    parser.add_argument("--fixture", default="", choices=["", *FIXTURES], help="Show canned data and do not connect")
    parser.add_argument("--screenshot", default="", help="Grab the window and exit. Implies offscreen unless a platform is set.")
    parser.add_argument("--self-check", action="store_true", help="Load QML offscreen and exit")
    parser.add_argument("--perf-log", default="", help="Append JSON lines with this process's samples")
    parser.add_argument("--version", action="version", version=f"layr-qt {__version__}")
    return parser.parse_args(argv)


def parse_geometry(value: str) -> tuple[int, int]:
    try:
        width, height = value.lower().split("x", 1)
        parsed = (int(width), int(height))
    except ValueError as exc:
        raise SystemExit("Geometry must look like 1024x600") from exc
    if parsed[0] < 320 or parsed[1] < 240 or parsed[0] > 4096 or parsed[1] > 4096:
        raise SystemExit("Geometry is out of range")
    return parsed


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    headless = bool(args.self_check or args.screenshot)
    if headless and not args.platform:
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        os.environ.setdefault("QT_QUICK_BACKEND", "software")
        os.environ.setdefault("QSG_RENDER_LOOP", "basic")
    os.environ.setdefault("QT_QUICK_CONTROLS_STYLE", "Basic")
    if args.platform:
        if args.platform.startswith("eglfs") and os.environ.get("LAYR_QT_ALLOW_EGLFS") != "1":
            print(
                "Refusing EGLFS/KMS. It can take the HDMI device from the display that is already running, and it has not been tested on a BTT HDMI7.",
                file=sys.stderr,
            )
            return 2
        os.environ["QT_QPA_PLATFORM"] = args.platform
    platform = os.environ.get("QT_QPA_PLATFORM", "")
    if platform.startswith("eglfs") and os.environ.get("LAYR_QT_ALLOW_EGLFS") != "1" and not headless:
        print(
            "Refusing EGLFS/KMS. It can take the HDMI device from the display that is already running, and it has not been tested on a BTT HDMI7.",
            file=sys.stderr,
        )
        return 2

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    from PyQt6.QtCore import QUrl
    from PyQt6.QtGui import QFont, QFontDatabase, QGuiApplication
    from PyQt6.QtQml import QQmlApplicationEngine

    from layr_qt.perf import PerfTracker
    from layr_qt.qt_host import Bridge, PressFilter, QtRuntime, ThumbProvider, paint_fixture_thumbnail

    qt_app = QGuiApplication([sys.argv[0]])
    families = set(QFontDatabase.families())
    font = next((name for name in ("Inter", "DejaVu Sans", "Noto Sans") if name in families), "Sans Serif")
    qt_app.setFont(QFont(font, 12))

    fixture_name = args.fixture or ("offline" if args.self_check else "")
    isolated = bool(fixture_name or headless)
    prefs_path = Path(args.config) if args.config else default_preferences_path()
    if isolated and not args.config:
        prefs_path = Path(tempfile.mkdtemp(prefix="layr-qt-")) / "preferences.json"
    prefs = load_preferences(prefs_path)
    if args.moonraker and not fixture_name:
        override = validate_moonraker_url(args.moonraker)
        if override is None:
            print("Moonraker URL must be http:// or https:// with no username or password.", file=sys.stderr)
            return 2
        prefs["moonrakerUrl"] = override

    store = PrinterStore()
    controller = Controller(MoonrakerSession(), store, prefs)
    controller.page = args.page or "home"
    if fixture_name:
        if fixture_name not in FIXTURES and fixture_name != "offline":
            print("Unknown fixture", file=sys.stderr)
            return 2
        controller.fixture = True
        controller.prefs = parse_preferences(fixture_preferences())
        apply_fixture(store, fixture_name if fixture_name in ("offline", "ready", "files") else "printing")
        if not args.page:
            controller.page = fixture_name if fixture_name in ("files", "controls", "settings") else "home"

    bridge = Bridge(font)
    provider = ThumbProvider()
    if store.thumbnail_path:
        paint_fixture_thumbnail(provider)
    runtime = QtRuntime(
        controller,
        bridge,
        PerfTracker(time.monotonic()),
        provider,
        prefs_path,
        Path(args.perf_log) if args.perf_log else None,
    )
    runtime.app = qt_app
    bridge.attach(runtime)

    engine = QQmlApplicationEngine()
    engine.addImportPath(str(QML_DIR))
    engine.addImageProvider("thumbs", provider)
    engine.rootContext().setContextProperty("bridge", bridge)
    errors: list = []
    engine.warnings.connect(lambda warnings: errors.extend(list(warnings)))
    runtime.publish()
    engine.load(QUrl.fromLocalFile(str(QML_DIR / "Main.qml")))
    if errors or not engine.rootObjects():
        for warning in errors:
            print(getattr(warning, "toString", lambda: str(warning))(), file=sys.stderr)
        print("QML failed to load. Run native-qt/scripts/check-deps.sh", file=sys.stderr)
        return 1

    window = engine.rootObjects()[0]
    runtime.window = window
    width, height = parse_geometry(args.geometry)
    window.setWidth(width)
    window.setHeight(height)
    qt_app.installEventFilter(PressFilter(runtime))
    if hasattr(window, "frameSwapped"):
        window.frameSwapped.connect(runtime.note_frame)
    if args.fullscreen and not headless:
        window.showFullScreen()
    else:
        window.show()
    runtime.start()

    if not headless:
        print(
            f"LAYR Qt prototype {__version__}. Read only. Moonraker {controller.prefs['moonrakerUrl']}. Not replacing the current display.",
            file=sys.stderr,
        )
        return qt_app.exec()

    if not _wait_for_frame(window):
        print("QML window did not render.", file=sys.stderr)
        return 1
    if errors:
        for warning in errors:
            print(getattr(warning, "toString", lambda: str(warning))(), file=sys.stderr)
        return 1
    if args.screenshot:
        image = window.grabWindow()
        path = Path(args.screenshot)
        path.parent.mkdir(parents=True, exist_ok=True)
        if image.isNull() or image.width() < 10 or not image.save(str(path)):
            print(f"Could not save {path}", file=sys.stderr)
            return 1
        print(f"Wrote {path}")
    return 0


def _wait_for_frame(window) -> bool:
    from PyQt6.QtCore import QEventLoop, QTimer

    loop = QEventLoop()
    seen = {"ok": False}

    def mark() -> None:
        seen["ok"] = True
        loop.quit()

    if hasattr(window, "frameSwapped"):
        window.frameSwapped.connect(mark)
    QTimer.singleShot(2500, loop.quit)
    loop.exec()
    if seen["ok"]:
        return True
    # Software/offscreen builds sometimes skip frameSwapped. A non-empty grab is enough for the self-check.
    image = window.grabWindow()
    return not image.isNull() and image.width() > 10
