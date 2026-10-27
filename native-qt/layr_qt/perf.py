"""Startup, CPU, RSS, and touch-to-frame samples.

These numbers describe this process only. They are not a comparison with
Chromium until the same sampler is run on the Pi against both processes.
"""

from __future__ import annotations

import json
import math
from pathlib import Path


def read_rss_kib(status_text: str) -> int | None:
    for line in status_text.splitlines():
        if line.startswith("VmRSS:"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1])
    return None


def proc_ticks(stat_text: str) -> int | None:
    """Sum of utime and stime from ``/proc/self/stat``."""
    end = stat_text.rfind(")")
    if end < 0:
        return None
    fields = stat_text[end + 2 :].split()
    # After the comm field, utime is index 11 and stime is index 12.
    if len(fields) < 13:
        return None
    try:
        return int(fields[11]) + int(fields[12])
    except ValueError:
        return None


def cpu_percent(delta_ticks: int, delta_seconds: float, ticks_per_sec: int) -> float | None:
    if delta_seconds <= 0 or ticks_per_sec <= 0:
        return None
    return (delta_ticks / ticks_per_sec) / delta_seconds * 100.0


def percentile_nearest(samples: list[float], percent: float) -> float | None:
    if not samples:
        return None
    ordered = sorted(samples)
    rank = math.ceil(percent / 100 * len(ordered)) - 1
    index = min(len(ordered) - 1, max(0, rank))
    return ordered[index]


class PerfTracker:
    def __init__(self, started_monotonic: float) -> None:
        self.started = started_monotonic
        self.startup_ms: float | None = None
        self.rss_kib: int | None = None
        self.cpu: float | None = None
        self.last_touch_ms: float | None = None
        self._press: float | None = None
        self._samples: list[float] = []
        self._last_ticks: int | None = None
        self._last_mono: float | None = None

    def note_press(self, now_monotonic: float) -> None:
        self._press = now_monotonic

    def note_frame(self, now_monotonic: float) -> None:
        if self.startup_ms is None:
            self.startup_ms = (now_monotonic - self.started) * 1000
        if self._press is None:
            return
        delta = (now_monotonic - self._press) * 1000
        self._press = None
        if 0 <= delta < 2000:
            self.last_touch_ms = delta
            self._samples.append(delta)
            self._samples = self._samples[-40:]

    def note_proc(self, status_text: str, stat_text: str, now_monotonic: float, ticks_per_sec: int) -> None:
        self.rss_kib = read_rss_kib(status_text)
        ticks = proc_ticks(stat_text)
        if ticks is not None and self._last_ticks is not None and self._last_mono is not None:
            self.cpu = cpu_percent(ticks - self._last_ticks, now_monotonic - self._last_mono, ticks_per_sec)
        if ticks is not None:
            self._last_ticks = ticks
            self._last_mono = now_monotonic

    def snapshot(self) -> dict:
        touch_p50 = percentile_nearest(self._samples, 50)
        return {
            "startupMs": None if self.startup_ms is None else round(self.startup_ms),
            "rssMb": None if self.rss_kib is None else round(self.rss_kib / 1024, 1),
            "cpuPercent": None if self.cpu is None else round(self.cpu, 1),
            "touchMs": None if self.last_touch_ms is None else round(self.last_touch_ms, 1),
            "touchP50Ms": None if touch_p50 is None else round(touch_p50, 1),
            "note": "This process only. Not a Chromium comparison.",
        }


def append_perf_log(path: Path, sample: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(sample, separators=(",", ":")) + "\n")
