"""Printer view model fed by Moonraker events. No Qt dependency."""

from __future__ import annotations

from typing import Any

from .files import map_metadata, pick_thumbnail
from .mapping import config_settings_from, merge_status
from .present import present, present_files
from .telemetry import config_number


class ViewModel:
    def __init__(self, display_name: str = "", moonraker_url: str = "") -> None:
        self.display_name = display_name
        self.moonraker_url = moonraker_url
        self.transport = "idle"
        self.klippy = "unknown"
        self.klippy_message: str | None = None
        self.transport_reason: str | None = None
        self.reconnect_attempt = 0
        self.hostname: str | None = None
        self.raw: dict[str, Any] = {}
        self.settings: dict[str, Any] = {}
        self.objects: list[str] = []
        self.missing: list[str] = []
        self.slicer_estimate: float | None = None
        self.metadata_for: str | None = None
        self.thumbnail_path: str | None = None
        self.directory = ""
        self.listing: dict[str, Any] | None = None
        self.files_message = ""

    @property
    def unconfigured(self) -> bool:
        return not self.moonraker_url.strip()

    def apply(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind == "transport":
            self.transport = str(event.get("state") or "idle")
            self.reconnect_attempt = int(event.get("attempt") or 0)
            self.transport_reason = event.get("reason")
            if self.transport != "connected":
                self.klippy = "unknown"
                self.klippy_message = None
        elif kind == "klippy":
            self.klippy = str(event.get("state") or "unknown")
            self.klippy_message = event.get("message")
        elif kind == "host":
            hostname = event.get("hostname")
            if isinstance(hostname, str) and hostname.strip():
                self.hostname = hostname.strip()
        elif kind == "snapshot":
            status = event.get("status")
            self.raw = status if isinstance(status, dict) else {}
            self.missing = list(event.get("missing") or [])
            self.objects = list(event.get("objects") or [])
            settings = event.get("settings")
            self.settings = settings if isinstance(settings, dict) else {}
            hostname = event.get("hostname")
            if isinstance(hostname, str) and hostname.strip():
                self.hostname = hostname.strip()
            self._refresh_metadata_target()
        elif kind == "status":
            diff = event.get("diff")
            if isinstance(diff, dict):
                merge_status(self.raw, diff)
                settings = config_settings_from(self.raw)
                if settings:
                    self.settings = settings
            self._refresh_metadata_target()
        elif kind == "metadata":
            filename = event.get("filename")
            if filename != self._job_filename():
                return
            meta = event.get("metadata")
            if isinstance(meta, dict):
                mapped = map_metadata(str(filename), meta)
                self.slicer_estimate = config_number(meta.get("estimated_time"))
                thumb = pick_thumbnail(mapped["thumbnails"], 96)
                self.thumbnail_path = thumb["path"] if thumb else None
            else:
                self.slicer_estimate = None
                self.thumbnail_path = None
            self.metadata_for = str(filename) if filename else None

    def note_metadata_request(self, filename: str) -> None:
        self.metadata_for = filename

    def metadata_wanted(self) -> str | None:
        filename = self._job_filename()
        if not filename or filename == self.metadata_for:
            return None
        if self.transport != "connected" or self.klippy != "ready":
            return None
        return filename

    def clear_thumbnail(self) -> None:
        self.thumbnail_path = None
        self.slicer_estimate = None

    def snapshot(self) -> dict[str, Any]:
        snap = present(
            {
                "displayName": self.display_name,
                "hostname": self.hostname,
                "transport": self.transport,
                "klippy": self.klippy,
                "klippyMessage": self.klippy_message,
                "transportReason": self.transport_reason,
                "reconnectAttempt": self.reconnect_attempt,
                "raw": self.raw,
                "settings": self.settings,
                "slicerEstimate": self.slicer_estimate,
                "unconfigured": self.unconfigured,
            }
        )
        snap["thumbnailPath"] = self.thumbnail_path or ""
        snap["moonrakerUrl"] = self.moonraker_url
        return snap

    def files_snapshot(self) -> dict[str, Any]:
        return present_files(self.listing, self.directory, self.files_message)

    def _job_filename(self) -> str | None:
        stats = self.raw.get("print_stats")
        if not isinstance(stats, dict):
            return None
        filename = stats.get("filename")
        if isinstance(filename, str) and filename.strip():
            return filename
        return None

    def _refresh_metadata_target(self) -> None:
        filename = self._job_filename()
        if filename != self.metadata_for:
            self.thumbnail_path = None
            self.slicer_estimate = None
