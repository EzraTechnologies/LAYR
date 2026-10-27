"""Startup, memory, and touch-to-frame marks.

Numbers written here are from this process only. They are not a comparison
with Chromium until the on-hardware procedure in docs/benchmark.md is run.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

PROCESS_START = time.perf_counter()


def rss_kib() -> int | None:
    try:
        for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        return None
    return None


def cpu_ticks() -> int | None:
    try:
        text = Path("/proc/self/stat").read_text(encoding="utf-8")
    except OSError:
        return None
    end = text.rfind(")")
    if end == -1:
        return None
    fields = text[end + 2 :].split()
    # utime and stime are fields 14 and 15 of the full stat line. After the
    # comm field (field 2) the next value is field 3, so indexes 11 and 12.
    try:
        return int(fields[11]) + int(fields[12])
    except (IndexError, ValueError):
        return None


class PerfLog:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        self.marks: list[dict[str, Any]] = []
        self._pending: dict[str, float] = {}
        self._latencies: list[float] = []

    def mark(self, name: str, **extra: Any) -> dict[str, Any]:
        row: dict[str, Any] = {
            "name": name,
            "ms": round((time.perf_counter() - PROCESS_START) * 1000, 1),
            "rssKib": rss_kib(),
            "cpuTicks": cpu_ticks(),
        }
        if extra:
            row["extra"] = extra
        self.marks.append(row)
        self._write(row)
        return row

    def press(self, control: str) -> None:
        self._pending[control] = time.perf_counter()
        self.mark("touch_down", control=control)

    def frame(self) -> None:
        if not self._pending:
            return
        now = time.perf_counter()
        for control, started in list(self._pending.items()):
            latency_ms = round((now - started) * 1000, 1)
            self._latencies.append(latency_ms)
            self.mark("touch_frame", control=control, latencyMs=latency_ms)
        self._pending.clear()

    def summary(self) -> dict[str, Any]:
        startup = _delta(self.marks, "process_start", "first_frame")
        connected = _delta(self.marks, "process_start", "moonraker_connected")
        latencies = sorted(self._latencies)
        median = latencies[len(latencies) // 2] if latencies else None
        return {
            "startupToFirstFrameMs": startup,
            "startupToConnectedMs": connected,
            "touchSamples": len(latencies),
            "touchMedianMs": median,
            "rssKib": rss_kib(),
            "cpuTicks": cpu_ticks(),
            "note": "Local process marks only. Not a Chromium comparison.",
        }

    def flush_summary(self) -> dict[str, Any]:
        summary = self.summary()
        self.mark("summary", **summary)
        return summary

    def _write(self, row: dict[str, Any]) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, separators=(",", ":")) + "\n")
        except OSError:
            self.path = None


def _delta(marks: list[dict[str, Any]], start: str, end: str) -> float | None:
    start_ms = next((row["ms"] for row in marks if row["name"] == start), None)
    end_ms = next((row["ms"] for row in marks if row["name"] == end), None)
    if start_ms is None or end_ms is None:
        return None
    return round(end_ms - start_ms, 1)
