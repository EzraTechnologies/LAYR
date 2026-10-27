"""Canned printer state for screenshots and the offscreen self-check.

Fixture mode never opens a socket and never invents data during a real session.
"""

from __future__ import annotations

from layr_qt.store import PrinterStore

PRINTING_RAW = {
    "extruder": {"temperature": 215.1, "target": 215, "power": 0.35, "can_extrude": True},
    "heater_bed": {"temperature": 60.0, "target": 60, "power": 0.12},
    "temperature_sensor chamber": {"temperature": 42.4},
    "print_stats": {
        "filename": "jobs/voron_cube.gcode",
        "state": "printing",
        "print_duration": 3720,
        "total_duration": 3900,
        "filament_used": 4200,
        "info": {"current_layer": 18, "total_layer": 120},
        "message": "",
    },
    "display_status": {"progress": 0.42},
    "motion_report": {"live_velocity": 120.4, "live_extruder_velocity": 3.2},
    "toolhead": {"extruder": "extruder", "homed_axes": "xyz", "position": [150.2, 120.0, 8.4, 12.0], "max_velocity": 300},
    "gcode_move": {"speed_factor": 1.0, "extrude_factor": 1.0},
    "configfile": {"settings": {"extruder": {"filament_diameter": "1.75"}}},
    "fan": {"speed": 0.8},
}


def apply_fixture(store: PrinterStore, kind: str) -> None:
    store.directory_loaded = True
    if kind == "offline":
        store.transport = "waiting"
        store.reason = "Connection closed"
        store.attempt = 2
        store.hostname = "mainsailos"
        return
    store.transport = "connected"
    store.klippy = "ready"
    store.hostname = "mainsailos"
    store.settings = {"extruder": {"filament_diameter": "1.75"}}
    if kind == "ready":
        store.raw = {
            "extruder": {"temperature": 28.4, "target": 0, "power": 0},
            "heater_bed": {"temperature": 27.1, "target": 0, "power": 0},
            "toolhead": {"extruder": "extruder", "homed_axes": "", "position": [0, 0, 0, 0], "max_velocity": 300},
            "motion_report": {"live_velocity": 0, "live_extruder_velocity": 0},
            "configfile": {"settings": {"extruder": {"filament_diameter": "1.75"}}},
            "print_stats": {"filename": "", "state": "standby"},
        }
        return
    store.raw = dict(PRINTING_RAW)
    store.metadata_for = "jobs/voron_cube.gcode"
    store.thumbnail_path = "jobs/.thumbs/voron_cube-300x300.png"
    store.slicer_estimate = 9000
    if kind == "files":
        store.directory_relative = "jobs"
        store.dirs = [{"name": "calibration", "path": "jobs/calibration", "modified": 1_700_000_000}]
        store.files = [
            {
                "path": "jobs/voron_cube.gcode",
                "name": "voron_cube.gcode",
                "modified": 1_720_000_000,
                "size": 1_800_000,
                "meta": {
                    "estimatedTime": 7200,
                    "filamentTotal": 4200,
                    "slicer": "OrcaSlicer 2.0",
                    "thumbnails": [{"path": "jobs/.thumbs/voron_cube-300x300.png", "width": 300, "height": 300}],
                },
            }
        ]
        store.selected_path = "jobs/voron_cube.gcode"


def fixture_preferences() -> dict:
    return {
        "moonrakerUrl": "http://localhost:7125",
        "displayName": "Trident",
        "theme": "midnight",
        "hideCursor": True,
        "dimAfterMinutes": 0,
    }
