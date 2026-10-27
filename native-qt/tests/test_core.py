"""Unit tests for telemetry, paths, preferences, and presentation."""

from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

from layr_qt.backoff import Backoff, BackoffOptions
from layr_qt.extensions import MMU_OBJECT_CANDIDATES, REJECTED_METHODS, is_allowed_method
from layr_qt.files import map_directory, map_thumbnails, pick_thumbnail
from layr_qt.formatutil import format_duration, format_flow
from layr_qt.mapping import estimate_remaining, merge_status
from layr_qt.paths import directory_rpc_path, gcodes_http_path, safe_relative_path
from layr_qt.preferences import Preferences, load_preferences, parse_preferences, save_preferences
from layr_qt.present import present
from layr_qt.subscription import plan_subscription
from layr_qt.telemetry import (
    filament_cross_section_area_mm2,
    filament_diameter_mm,
    map_motion,
    quantize_flow_mm3_s,
    quantize_speed_mm_s,
    volumetric_flow_mm3_per_s,
)
from layr_qt.urls import is_valid_moonraker_url, redact_url, to_websocket_url
from layr_qt.viewmodel import ViewModel


class TelemetryTests(unittest.TestCase):
    def test_area_and_sign(self) -> None:
        area = filament_cross_section_area_mm2(1.75)
        self.assertAlmostEqual(area, math.pi * 0.875 * 0.875, places=10)
        self.assertAlmostEqual(volumetric_flow_mm3_per_s(5, 1.75), 5 * area, places=10)
        self.assertAlmostEqual(volumetric_flow_mm3_per_s(-4, 1.75), -4 * area, places=10)
        self.assertEqual(volumetric_flow_mm3_per_s(0, 2.85), 0)

    def test_quantize(self) -> None:
        self.assertEqual(quantize_speed_mm_s(48.2), 48)
        self.assertEqual(quantize_flow_mm3_s(12.049), 12)
        self.assertEqual(quantize_flow_mm3_s(-0.04), 0)

    def test_map_motion_ignores_factors(self) -> None:
        reading = map_motion(
            {
                "motion_report": {"live_velocity": 48.2, "live_extruder_velocity": 5},
                "toolhead": {"extruder": "extruder"},
                "gcode_move": {"speed_factor": 1.5, "extrude_factor": 0.8},
            },
            {"extruder": {"filament_diameter": "1.75"}},
        )
        self.assertEqual(reading["speedMmS"], 48)
        self.assertEqual(reading["flowMm3S"], quantize_flow_mm3_s(volumetric_flow_mm3_per_s(5, 1.75)))
        self.assertNotEqual(reading["speedMmS"], 150)
        self.assertNotIn("%", str(reading["flowMm3S"]))

    def test_missing_report_does_not_invent_speed(self) -> None:
        reading = map_motion({"gcode_move": {"speed_factor": 2, "extrude_factor": 1.25}, "toolhead": {"max_velocity": 300}}, {})
        self.assertEqual(reading["speedMmS"], None)
        self.assertEqual(reading["flowMm3S"], None)
        self.assertEqual(reading["flowGap"], "velocity")

    def test_active_extruder_diameter(self) -> None:
        reading = map_motion(
            {"motion_report": {"live_velocity": 20, "live_extruder_velocity": 1}, "toolhead": {"extruder": "extruder1"}},
            {"extruder": {"filament_diameter": "1.75"}, "extruder1": {"filament_diameter": "2.85"}},
        )
        self.assertEqual(reading["filamentDiameterMm"], 2.85)
        self.assertEqual(reading["flowMm3S"], quantize_flow_mm3_s(volumetric_flow_mm3_per_s(1, 2.85)))

    def test_retraction_is_negative_and_bad_diameter_is_not_175(self) -> None:
        stopped = map_motion(
            {"motion_report": {"live_velocity": 0, "live_extruder_velocity": 0}},
            {"extruder": {"filament_diameter": 1.75}},
        )
        self.assertEqual(stopped["speedMmS"], 0)
        self.assertEqual(stopped["flowMm3S"], 0)
        retract = map_motion(
            {"motion_report": {"live_velocity": 30, "live_extruder_velocity": -4}},
            {"extruder": {"filament_diameter": 1.75}},
        )
        self.assertLess(retract["flowMm3S"], 0)
        self.assertIsNone(filament_diameter_mm({"extruder": {"filament_diameter": "nope"}}, "extruder"))
        self.assertIsNone(filament_diameter_mm({"extruder": {"filament_diameter": 12}}, "extruder"))
        self.assertEqual(filament_diameter_mm({"extruder": {"filament_diameter": " 1.75 "}}, "extruder"), 1.75)

    def test_negative_live_velocity_is_not_a_direction(self) -> None:
        reading = map_motion(
            {"motion_report": {"live_velocity": -5, "live_extruder_velocity": 1}},
            {"extruder": {"filament_diameter": 1.75}},
        )
        self.assertEqual(reading["speedMmS"], 0)


class PresentTests(unittest.TestCase):
    def test_dashboard_uses_live_motion_and_clears_on_disconnect(self) -> None:
        raw = {
            "motion_report": {"live_velocity": 48.2, "live_extruder_velocity": -4},
            "gcode_move": {"speed_factor": 2, "extrude_factor": 1.2},
            "toolhead": {"extruder": "extruder", "homed_axes": "xy", "position": [1, 2, 3, 0]},
            "extruder": {"temperature": 200.2, "target": 210, "can_extrude": True},
            "heater_bed": {"temperature": 60, "target": 60},
            "print_stats": {
                "filename": "parts/hook.gcode",
                "state": "printing",
                "print_duration": 100,
                "total_duration": 110,
                "info": {"current_layer": 2, "total_layer": 10},
            },
            "display_status": {"progress": 0.25},
        }
        settings = {"extruder": {"filament_diameter": 1.75}}
        shown = present(
            {
                "displayName": "",
                "hostname": "voron",
                "transport": "connected",
                "klippy": "ready",
                "raw": raw,
                "settings": settings,
                "slicerEstimate": 9999,
                "unconfigured": False,
            }
        )
        self.assertEqual(shown["printerName"], "voron")
        self.assertEqual(shown["speedText"], "48")
        self.assertNotEqual(shown["speedText"], "200")
        self.assertTrue(shown["flowText"].startswith("-"))
        self.assertEqual(shown["speedFactorText"], "200%")
        self.assertEqual(shown["extrudeFactorText"], "120%")
        self.assertNotIn("%", shown["speedText"])
        self.assertEqual(shown["nozzle"]["temp"], "200")
        self.assertEqual(shown["filename"], "hook")
        self.assertEqual(shown["remainingSource"], "progress")

        offline = present(
            {
                "displayName": "Panel",
                "hostname": "voron",
                "transport": "waiting",
                "klippy": "unknown",
                "transportReason": "Connection closed",
                "raw": raw,
                "settings": settings,
                "unconfigured": False,
            }
        )
        self.assertEqual(offline["printerName"], "Panel")
        self.assertEqual(offline["status"], "disconnected")
        self.assertEqual(offline["speedText"], "—")
        self.assertEqual(offline["speedFactorText"], "—")
        self.assertEqual(offline["flowText"], "—")
        self.assertEqual(offline["nozzle"]["temp"], "—")
        self.assertIn("Retrying", offline["statusDetail"])


class PathTests(unittest.TestCase):
    def test_thumbnail_paths_stay_under_gcodes(self) -> None:
        thumbs = map_thumbnails(
            "jobs/part.gcode",
            [{"relative_path": ".thumbs/part-300x300.png", "width": 300, "height": 300}, {"relative_path": "../../etc/passwd"}],
        )
        self.assertEqual(thumbs[0]["path"], "jobs/.thumbs/part-300x300.png")
        self.assertEqual(len(thumbs), 1)
        self.assertIsNone(safe_relative_path("/etc/passwd"))
        self.assertIsNone(safe_relative_path("http://evil/a.png"))
        self.assertIsNone(gcodes_http_path("../secret"))
        self.assertEqual(gcodes_http_path("my dir/a#1.png"), "/server/files/gcodes/my%20dir/a%231.png")
        self.assertEqual(directory_rpc_path(""), "gcodes")
        self.assertEqual(directory_rpc_path("jobs"), "gcodes/jobs")
        self.assertIsNone(directory_rpc_path("../"))

    def test_directory_skips_hidden_and_non_gcode(self) -> None:
        mapped = map_directory(
            "jobs",
            {
                "dirs": [{"dirname": ".thumbs"}, {"dirname": "more"}],
                "files": [{"filename": "notes.txt"}, {"filename": "a.gcode", "modified": 2, "size": 10}],
            },
        )
        self.assertEqual([item["name"] for item in mapped["dirs"]], ["more"])
        self.assertEqual(mapped["files"][0]["path"], "jobs/a.gcode")
        self.assertEqual(pick_thumbnail(map_thumbnails("a.gcode", [{"relative_path": "t.png", "width": 32}]), 96)["path"], "t.png")


class PreferenceTests(unittest.TestCase):
    def test_round_trip_and_rejects_secrets_in_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "preferences.json"
            prefs = Preferences(moonraker_url="http://localhost:7125", display_name="  Side\npanel  ", hide_cursor=True, theme="black")
            prefs.display_name = "Side panel"
            save_preferences(prefs, path)
            loaded = load_preferences(path)
            self.assertEqual(loaded.display_name, "Side panel")
            self.assertEqual(loaded.theme, "black")
            self.assertTrue(loaded.hide_cursor)
        rejected = parse_preferences(json.dumps({"moonrakerUrl": "http://user:secret@printer:7125", "displayName": "x" * 40}))
        self.assertEqual(rejected.moonraker_url, "http://localhost:7125")
        self.assertEqual(len(rejected.display_name), 32)
        self.assertFalse(is_valid_moonraker_url("http://user:pw@host:7125"))
        self.assertTrue(is_valid_moonraker_url("http://localhost:7125"))
        self.assertNotIn("token=", redact_url(to_websocket_url("http://localhost:7125") + "?token=secret"))


class SubscriptionTests(unittest.TestCase):
    def test_motion_fields_and_no_mmu(self) -> None:
        plan = plan_subscription(
            ["extruder", "heater_bed", "print_stats", "motion_report", "webhooks", "toolhead", "mmu", "AFC", "gcode_macro START_PRINT"]
        )
        objects = plan["objects"]
        assert isinstance(objects, dict)
        self.assertEqual(objects["motion_report"], ["live_velocity", "live_extruder_velocity"])
        self.assertNotIn("mmu", objects)
        self.assertNotIn("AFC", objects)
        for name in MMU_OBJECT_CANDIDATES:
            self.assertNotIn(name, objects)
        for method in REJECTED_METHODS:
            self.assertFalse(is_allowed_method(method))
        self.assertTrue(is_allowed_method("printer.objects.subscribe"))


class EstimateTests(unittest.TestCase):
    def test_progress_beats_slicer_after_five_percent(self) -> None:
        estimate = estimate_remaining(0.25, 100, 9999)
        self.assertEqual(estimate["source"], "progress")
        self.assertAlmostEqual(estimate["remaining"], 300)
        early = estimate_remaining(0.01, 10, 500)
        self.assertEqual(early["source"], "slicer")
        self.assertEqual(format_duration(300), "5m 00s")
        self.assertEqual(format_duration(600), "10m")
        self.assertEqual(format_flow(-1.26), "-1.3")

    def test_merge_is_partial(self) -> None:
        target = {"extruder": {"temperature": 20, "target": 0}, "print_stats": {"info": {"current_layer": 1}}}
        merge_status(target, {"extruder": {"temperature": 21}, "print_stats": {"info": {"total_layer": 4}}})
        self.assertEqual(target["extruder"]["target"], 0)
        self.assertEqual(target["print_stats"]["info"]["current_layer"], 1)
        self.assertEqual(target["print_stats"]["info"]["total_layer"], 4)


class ViewModelTests(unittest.TestCase):
    def test_disconnect_drops_live_values_and_metadata_follows_filename(self) -> None:
        model = ViewModel("Bench", "http://localhost:7125")
        model.apply({"type": "transport", "state": "connected", "attempt": 0, "reason": None})
        model.apply({"type": "klippy", "state": "ready", "message": None})
        model.apply({"type": "host", "hostname": "pi"})
        model.apply(
            {
                "type": "snapshot",
                "status": {
                    "extruder": {"temperature": 180, "target": 200},
                    "print_stats": {"filename": "a.gcode", "state": "printing", "print_duration": 50, "total_duration": 50},
                    "display_status": {"progress": 0.5},
                    "motion_report": {"live_velocity": 10, "live_extruder_velocity": 1},
                },
                "settings": {"extruder": {"filament_diameter": 1.75}},
                "objects": [],
                "missing": [],
                "hostname": "pi",
            }
        )
        self.assertEqual(model.metadata_wanted(), "a.gcode")
        model.note_metadata_request("a.gcode")
        model.apply(
            {
                "type": "metadata",
                "filename": "a.gcode",
                "metadata": {"estimated_time": 120, "thumbnails": [{"relative_path": ".thumbs/a.png", "width": 200, "height": 200}]},
            }
        )
        self.assertEqual(model.thumbnail_path, ".thumbs/a.png")
        snap = model.snapshot()
        self.assertEqual(snap["printerName"], "Bench")
        self.assertEqual(snap["speedText"], "10")
        model.apply({"type": "status", "diff": {"print_stats": {"filename": "b.gcode"}}})
        self.assertIsNone(model.thumbnail_path)
        self.assertEqual(model.metadata_wanted(), "b.gcode")
        model.apply({"type": "transport", "state": "waiting", "attempt": 1, "reason": "Connection closed"})
        self.assertEqual(model.snapshot()["nozzle"]["temp"], "—")
        self.assertEqual(model.snapshot()["status"], "disconnected")


if __name__ == "__main__":
    unittest.main()
