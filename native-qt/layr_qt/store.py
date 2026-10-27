"""Reducer for Moonraker session events. The view is built from this state."""

from __future__ import annotations

from layr_qt.moonraker.files import safe_gcode_filename
from layr_qt.moonraker.protocol import merge_status


class PrinterStore:
    def __init__(self) -> None:
        self.transport = "idle"
        self.klippy = "unknown"
        self.klippy_message: str | None = None
        self.reason: str | None = None
        self.attempt = 0
        self.hostname: str | None = None
        self.raw: dict = {}
        self.settings: dict = {}
        self.objects: list[str] = []
        self.missing: list[str] = []
        self.metadata_for: str | None = None
        self.thumbnail_path: str | None = None
        self.slicer_estimate: float | None = None
        self.directory_relative = ""
        self.dirs: list[dict] = []
        self.files: list[dict] = []
        self.directory_error = ""
        self.directory_loaded = False
        self.selected_path: str | None = None

    def apply(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "transport":
            self.transport = event.get("state") or "idle"
            self.attempt = int(event.get("attempt") or 0)
            self.reason = event.get("reason")
            if self.transport in ("waiting", "idle"):
                self.klippy = "unknown"
            return
        if kind == "klippy":
            self.klippy = event.get("state") or "unknown"
            self.klippy_message = event.get("message")
            return
        if kind == "host":
            hostname = event.get("hostname")
            self.hostname = hostname.strip() if isinstance(hostname, str) and hostname.strip() else self.hostname
            return
        if kind == "snapshot":
            self.raw = dict(event.get("status") or {})
            settings = event.get("settings")
            self.settings = dict(settings) if isinstance(settings, dict) else {}
            self.objects = list(event.get("objects") or [])
            self.missing = list(event.get("missing") or [])
            if event.get("klippy"):
                self.klippy = event["klippy"]
            self._sync_filename()
            return
        if kind == "status":
            merge_status(self.raw, event.get("diff") or {})
            configfile = self.raw.get("configfile")
            if isinstance(configfile, dict) and isinstance(configfile.get("settings"), dict):
                self.settings = {**self.settings, **configfile["settings"]}
            self._sync_filename()
            return
        if kind == "metadata":
            self._apply_metadata(event)
            return
        if kind == "directory":
            self.directory_relative = event.get("relative") or ""
            self.directory_error = event.get("error") or ""
            if not self.directory_error:
                self.dirs = list(event.get("dirs") or [])
                self.files = list(event.get("files") or [])
                self.directory_loaded = True
            return

    def take_metadata_request(self) -> str | None:
        if self.transport != "connected" or self.klippy != "ready":
            return None
        filename = self._filename()
        if not filename:
            if self.metadata_for is not None:
                self.metadata_for = None
                self.thumbnail_path = None
                self.slicer_estimate = None
            return None
        if filename == self.metadata_for:
            return None
        self.metadata_for = filename
        self.thumbnail_path = None
        self.slicer_estimate = None
        return filename

    def file_entry(self, path: str) -> dict | None:
        for entry in self.files:
            if entry.get("path") == path:
                return entry
        return None

    def _filename(self) -> str | None:
        stats = self.raw.get("print_stats")
        if not isinstance(stats, dict):
            return None
        filename = stats.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            return None
        return safe_gcode_filename(filename) or filename.strip()

    def _sync_filename(self) -> None:
        filename = self._filename()
        if filename != self.metadata_for and self.metadata_for is not None and not filename:
            self.metadata_for = None
            self.thumbnail_path = None
            self.slicer_estimate = None

    def _apply_metadata(self, event: dict) -> None:
        purpose = event.get("purpose")
        filename = event.get("filename")
        if purpose == "job":
            if filename != self.metadata_for:
                return
            if event.get("error"):
                return
            self.slicer_estimate = event.get("estimated_time")
            self.thumbnail_path = event.get("thumbnail_path")
            return
        if purpose == "file" and isinstance(filename, str) and not event.get("error"):
            entry = self.file_entry(filename)
            if entry is not None:
                entry["meta"] = event.get("meta")
