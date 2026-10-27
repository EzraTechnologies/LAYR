"""Transparent Xcursor theme so Cage does not draw an arrow over the touchscreen.

Qt's BlankCursor only affects Qt's own sprite. Cage composites the pointer from
the Xcursor theme because the BTT HDMI7 touch device is also a pointer. A 1×1
fully transparent cursor hides that sprite. The device stays enabled, so touch
and a physical mouse still deliver clicks.

This has not been confirmed on the HDMI7. ``qt-kiosk.sh --print-env`` only
checks that the theme files and environment are produced.
"""

from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

XCURSOR_MAGIC = 0x72756358
IMAGE_TYPE = 0xFFFD0002
NAMES = (
    "left_ptr",
    "default",
    "arrow",
    "top_left_arrow",
    "hand",
    "hand1",
    "hand2",
    "pointer",
    "xterm",
    "ibeam",
    "text",
    "cross",
    "crosshair",
    "watch",
    "wait",
    "progress",
    "help",
    "not-allowed",
    "no-drop",
    "circle",
    "plus",
    "cell",
    "grab",
    "grabbing",
    "copy",
    "alias",
    "move",
    "all-scroll",
    "col-resize",
    "row-resize",
    "n-resize",
    "s-resize",
    "e-resize",
    "w-resize",
    "ne-resize",
    "nw-resize",
    "se-resize",
    "sw-resize",
    "ew-resize",
    "ns-resize",
    "nesw-resize",
    "nwse-resize",
    "vertical-text",
    "context-menu",
    "zoom-in",
    "zoom-out",
)


def cursor_bytes() -> bytes:
    pixels = struct.pack("<I", 0)
    image = struct.pack("<IIIIIIIII", 36, IMAGE_TYPE, 1, 1, 1, 1, 0, 0, 0) + pixels
    header = struct.pack("<IIII", XCURSOR_MAGIC, 16, 0x00010000, 1)
    toc = struct.pack("<III", IMAGE_TYPE, 1, 16 + 12)
    return header + toc + image


def write_blank_theme(directory: Path) -> Path:
    """Write ``directory/layr-blank``. Returns that theme directory."""
    root = Path(directory) / "layr-blank"
    cursors = root / "cursors"
    cursors.mkdir(parents=True, exist_ok=True)
    (cursors / "left_ptr").write_bytes(cursor_bytes())
    for name in NAMES:
        if name == "left_ptr":
            continue
        link = cursors / name
        if link.is_symlink() or link.exists():
            link.unlink()
        os.symlink("left_ptr", link)
    (root / "index.theme").write_text(
        "[Icon Theme]\nName=layr-blank\nComment=Transparent cursor for the LAYR Qt kiosk\n",
        encoding="utf-8",
    )
    return root


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("usage: python3 -m layr_qt.blank_cursor DIRECTORY", file=sys.stderr)
        return 2
    write_blank_theme(Path(args[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
