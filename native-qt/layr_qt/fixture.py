"""Labeled fixture data for offscreen screenshots. Never used for a normal launch."""

from __future__ import annotations

import struct
import zlib

from .files import map_directory
from .viewmodel import ViewModel


def rgb_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    pixel = bytes(rgb)
    raw = b"".join(b"\x00" + pixel * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def fixture_model() -> ViewModel:
    model = ViewModel("Trident", "http://localhost:7125")
    model.transport = "connected"
    model.klippy = "ready"
    model.hostname = "voron.local"
    model.metadata_for = "fixtures/bracket.gcode"
    model.slicer_estimate = 5400
    model.thumbnail_path = "fixtures/.thumbs/bracket-300x300.png"
    model.raw = {
        "extruder": {"temperature": 214.4, "target": 220, "power": 0.35, "can_extrude": True},
        "heater_bed": {"temperature": 60.1, "target": 60, "power": 0.18},
        "temperature_sensor chamber": {"temperature": 38.2},
        "print_stats": {
            "filename": "fixtures/bracket.gcode",
            "state": "printing",
            "print_duration": 900,
            "total_duration": 960,
            "filament_used": 1200,
            "info": {"current_layer": 42, "total_layer": 180},
        },
        "display_status": {"progress": 0.22},
        "motion_report": {"live_velocity": 120.4, "live_extruder_velocity": 4.2},
        "gcode_move": {"speed_factor": 1.5, "extrude_factor": 0.95, "homing_origin": [0, 0, 0]},
        "toolhead": {
            "extruder": "extruder",
            "homed_axes": "xyz",
            "position": [120.5, 110.0, 8.4, 0],
            "max_velocity": 300,
        },
        "fan": {"speed": 0.65, "rpm": 4200},
        "configfile": {"settings": {"extruder": {"filament_diameter": "1.75"}}},
    }
    model.settings = {"extruder": {"filament_diameter": "1.75"}}
    model.listing = map_directory(
        "",
        {
            "dirs": [{"dirname": "fixtures", "modified": 1}],
            "files": [
                {
                    "filename": "bracket.gcode",
                    "modified": 1_700_000_000,
                    "size": 2_400_000,
                    "estimated_time": 5400,
                    "filament_type": "ASA",
                    "slicer": "OrcaSlicer",
                    "thumbnails": [{"width": 300, "height": 300, "relative_path": ".thumbs/bracket.png"}],
                }
            ],
        },
    )
    model.files_message = ""
    return model
