"""Canned Spoolman rows for fixture screenshots. Not used on a live socket."""

from __future__ import annotations

import base64
import struct
import zlib

from layr_qt.spoolman.api import ingest_proxy


def solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def fixture_payload() -> list[dict]:
    photo = base64.b64encode(solid_png(48, 48, (32, 96, 220))).decode("ascii")
    return [
        {
            "id": 7,
            "filament": {
                "id": 1,
                "name": "PolyTerra Charcoal",
                "vendor": {"name": "Polymaker"},
                "material": "PLA",
                "color_hex": "2B2B2B",
                "weight": 1000,
                "extra": {"photo": f"data:image/png;base64,{photo}"},
            },
            "remaining_weight": 740,
            "used_weight": 260,
            "archived": False,
            "location": "Shelf A",
            "lot_nr": "L1",
        },
        {
            "id": 8,
            "filament": {
                "id": 2,
                "name": "Galaxy Black",
                "vendor": {"name": "Prusament"},
                "material": "PETG",
                "color_hex": "1A1A1A",
                "weight": 1000,
                "extra": {"image": "https://example.invalid/spool.jpg"},
            },
            "remaining_weight": 500,
            "used_weight": 500,
            "archived": False,
            "location": "Dry box",
        },
        {
            "id": 9,
            "filament": {"id": 3},
            "archived": False,
        },
        {
            "id": 10,
            "filament": {
                "id": 4,
                "name": "Old Red",
                "vendor": {"name": "Polymaker"},
                "material": "PLA",
                "multi_color_hexes": "ff0000,00aa44",
                "weight": 1000,
            },
            "remaining_weight": 0,
            "used_weight": 1000,
            "archived": True,
            "location": "Bin",
            "comment": "Finished spool",
        },
    ]


def load_fixture_spools(model, printer_key: str) -> None:
    ingested = ingest_proxy({"response": fixture_payload(), "error": None})
    model.load_fixture(printer_key, ingested["spools"], ingested["images"], 7)
