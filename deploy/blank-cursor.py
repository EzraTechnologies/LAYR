#!/usr/bin/env python3
"""Write a transparent Xcursor theme named layr-blank.

Cage draws its own arrow when any input device can move a pointer. The BTT HDMI7
touchscreen shows up as a mouse, and Chromium's CSS cursor is not enough to clear
that compositor cursor. A blank theme hides the sprite without removing the device,
so touch and a physical mouse still deliver clicks.

Usage: blank-cursor.py DIRECTORY
Creates DIRECTORY/layr-blank/.
"""

from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

# libXcursor file layout: 16-byte header, 12-byte TOC entries, 36-byte image header, pixels.
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
    width = height = 1
    pixels = struct.pack("<I", 0)
    image = struct.pack("<IIIIIIIII", 36, IMAGE_TYPE, 1, 1, width, height, 0, 0, 0) + pixels
    position = 16 + 12
    header = struct.pack("<IIII", XCURSOR_MAGIC, 16, 0x00010000, 1)
    toc = struct.pack("<III", IMAGE_TYPE, 1, position)
    return header + toc + image


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: blank-cursor.py DIRECTORY", file=sys.stderr)
        sys.exit(2)
    root = Path(sys.argv[1]) / "layr-blank"
    cursors = root / "cursors"
    cursors.mkdir(parents=True, exist_ok=True)
    target = cursors / "left_ptr"
    target.write_bytes(cursor_bytes())
    for name in NAMES:
        if name == "left_ptr":
            continue
        link = cursors / name
        if link.is_symlink() or link.exists():
            link.unlink()
        os.symlink("left_ptr", link)
    (root / "index.theme").write_text(
        "[Icon Theme]\nName=layr-blank\nComment=Transparent cursor for the LAYR kiosk\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
