#!/usr/bin/env python3
"""Print 1 if Hide pointer is on in a Chromium LAYR profile, else 0.

Chromium keeps localStorage in LevelDB:
  <profile>/Default/Local Storage/leveldb/
The JSON is the `layr.ui` object. Values may be UTF-8 or UTF-16LE.
This only reads the profile. It does not change it, and it does not look at the Linux hostname.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def last_hide_cursor(data: bytes) -> bool | None:
    # Offsets are bytes so a UTF-16 match can be ordered against a UTF-8 match
    # in the same blob. Character indexes are not comparable across encodings.
    found: list[tuple[int, bool]] = []
    for encoding, width in (("utf-8", 1), ("utf-16-le", 2)):
        text = data.decode(encoding, errors="ignore")
        for match in re.finditer(r'"hideCursor"\s*:\s*(true|false)', text):
            found.append((match.start() * width, match.group(1) == "true"))
    if not found:
        return None
    found.sort()
    return found[-1][1]


def main() -> None:
    profile = Path(sys.argv[1]) if len(sys.argv) > 1 else Path()
    level = profile / "Default" / "Local Storage" / "leveldb"
    if not level.is_dir():
        print("0")
        return
    flag: bool | None = None
    for path in sorted(level.iterdir()):
        if path.suffix not in {".log", ".ldb"}:
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        value = last_hide_cursor(data)
        if value is not None:
            flag = value
    print("1" if flag else "0")


if __name__ == "__main__":
    main()
