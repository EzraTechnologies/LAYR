"""Per-printer Spoolman catalogue. Dropped when the Moonraker URL changes."""

from __future__ import annotations

from layr_qt.spoolman.api import (
    UI_PAGE,
    matches,
    option_list,
    row_view,
)

SETUP_HELP = (
    "Spoolman is not enabled in Moonraker. Printing does not need it. "
    "When you want this screen, add a [spoolman] server in Moonraker's own configuration and restart Moonraker there. "
    "LAYR does not edit moonraker.conf."
)
OFFLINE_HELP = "Moonraker cannot reach Spoolman. No spool was changed. Printing still works."
HIDDEN_HELP = "Spoolman readings from this printer are hidden until Moonraker is connected again."


def empty_spool_view() -> dict:
    return {
        "phase": "hidden",
        "message": "",
        "help": "",
        "printerKey": "",
        "printerLabel": "",
        "connected": False,
        "paging": False,
        "activeKnown": False,
        "activeId": None,
        "activeText": "",
        "focus": None,
        "rows": [],
        "count": 0,
        "matched": 0,
        "page": 0,
        "pages": 1,
        "range": "",
        "search": "",
        "material": "",
        "vendor": "",
        "status": "available",
        "color": "",
        "materials": [],
        "vendors": [],
        "moreMaterials": False,
        "moreVendors": False,
        "canSet": False,
        "canClear": False,
        "canUnload": False,
        "locked": False,
        "lockReason": "",
        "unloadMacros": [],
        "unloadHint": "",
        "selectedId": None,
    }


class SpoolmanModel:
    def __init__(self) -> None:
        self.printer_key = ""
        self.generation = 0
        self.phase = "hidden"
        self.message = HIDDEN_HELP
        self.connected: bool | None = None
        self.active_known = False
        self.active_id: int | None = None
        self.spools: list[dict] = []
        self.images: dict[str, bytes] = {}
        self.rejected_images = 0
        self.search = ""
        self.material = ""
        self.vendor = ""
        self.status = "available"
        self.color = ""
        self.page = 0
        self.selected_id: int | None = None
        self._paging = False

    def hide(self, message: str = HIDDEN_HELP) -> None:
        self.generation = 0
        self.phase = "hidden"
        self.message = message
        self.connected = None
        self.active_known = False
        self.active_id = None
        self._clear_catalog()

    def expect(self, printer_key: str, generation: int) -> None:
        if printer_key != self.printer_key:
            self._clear_catalog()
            self.active_known = False
            self.active_id = None
            self.selected_id = None
        self.printer_key = printer_key
        self.generation = generation
        self.phase = "loading"
        self.message = "Reading spools from this printer…"
        self._paging = True

    def load_fixture(self, printer_key: str, spools: list[dict], images: dict[str, bytes], active_id: int | None) -> None:
        self.printer_key = printer_key
        self.generation = 1
        self.phase = "ready"
        self.message = "Fixture data. Nothing is sent."
        self.connected = True
        self.active_known = True
        self.active_id = active_id
        self.spools = list(spools)
        self.images = dict(images)
        self.rejected_images = 0
        self._paging = False
        self.page = 0

    def facts(self) -> dict:
        return {
            "phase": self.phase,
            "printerKey": self.printer_key,
            "activeKnown": self.active_known,
            "activeId": self.active_id,
            "ids": [record["id"] for record in self.spools],
            "names": {record["id"]: record["name"] for record in self.spools},
            "archived": [record["id"] for record in self.spools if record.get("archived")],
        }

    def set_filter(self, *, search: str | None = None, material: str | None = None, vendor: str | None = None, status: str | None = None, color: str | None = None) -> None:
        if search is not None:
            self.search = search[:64]
        if material is not None:
            self.material = material
        if vendor is not None:
            self.vendor = vendor
        if status is not None and status in ("available", "all", "archived", "empty", "active"):
            self.status = status
        if color is not None:
            self.color = color
        self.page = 0

    def move_page(self, delta: int) -> None:
        self.page = max(0, self.page + int(delta))

    def select(self, spool_id: int) -> None:
        self.selected_id = spool_id if spool_id > 0 else None

    def acknowledge(self, spool_id: int | None) -> None:
        self.active_known = True
        self.active_id = spool_id

    def apply(self, event: dict) -> None:
        if event.get("printerKey") != self.printer_key or event.get("generation") != self.generation:
            return
        part = event.get("part")
        if part == "status":
            self._apply_status(event)
        elif part == "active":
            self._apply_active(event)
        elif part == "list":
            self._apply_list(event)
        elif part == "link":
            self._apply_link(event)
        elif part == "notify-active":
            self._apply_notified_active(event)

    def _apply_status(self, event: dict) -> None:
        if event.get("absent"):
            self.phase = "absent"
            self.connected = False
            self.message = SETUP_HELP
            self._clear_catalog()
            self.active_known = False
            self.active_id = None
            return
        if not event.get("ok"):
            self.phase = "error"
            self.message = event.get("error") or "Spoolman status failed"
            return
        self.connected = bool(event.get("connected"))
        if event.get("activeKnown"):
            self.active_known = True
            self.active_id = event.get("spoolId")
        if not self.connected:
            self.phase = "offline"
            self.message = OFFLINE_HELP
            self._clear_catalog()

    def _apply_active(self, event: dict) -> None:
        if not event.get("ok"):
            if self.phase == "loading":
                self.phase = "error"
                self.message = event.get("error") or "Could not read the active spool"
            return
        self.active_known = True
        self.active_id = event.get("spoolId")

    def _apply_list(self, event: dict) -> None:
        if event.get("offline"):
            self.phase = "offline"
            self.message = OFFLINE_HELP
            self._clear_catalog()
            self._paging = False
            return
        if not event.get("ok"):
            self.phase = "error"
            self.message = event.get("error") or "Could not list spools"
            self._paging = False
            return
        offset = int(event.get("offset") or 0)
        incoming = list(event.get("spools") or [])
        if offset == 0:
            self.spools = incoming
            self.images = dict(event.get("images") or {})
            self.rejected_images = int(event.get("rejected") or 0)
        else:
            have = {record["id"] for record in self.spools}
            for record in incoming:
                if record["id"] not in have:
                    self.spools.append(record)
                    have.add(record["id"])
            self.images.update(event.get("images") or {})
            self.rejected_images += int(event.get("rejected") or 0)
        self._paging = bool(event.get("more"))
        if not self._paging:
            self.phase = "ready"
            self.message = "" if self.spools else "Spoolman has no spools."

    def _apply_link(self, event: dict) -> None:
        connected = bool(event.get("connected"))
        self.connected = connected
        if not connected:
            self.phase = "offline"
            self.message = OFFLINE_HELP
            self._clear_catalog()

    def _apply_notified_active(self, event: dict) -> None:
        if not event.get("ok"):
            return
        self.active_known = True
        self.active_id = event.get("spoolId")

    def record(self, spool_id: int | None) -> dict | None:
        if spool_id is None:
            return None
        for record in self.spools:
            if record["id"] == spool_id:
                return record
        return None

    def view(self, *, printing: bool, printer_label: str, unload_macros: list[dict]) -> dict:
        materials, more_materials = option_list(self.spools, "material")
        vendors, more_vendors = option_list(self.spools, "vendor")
        filtered = [
            record
            for record in self.spools
            if matches(
                record,
                search=self.search,
                material=self.material,
                vendor=self.vendor,
                status=self.status,
                color=self.color,
                active_id=self.active_id,
            )
        ]
        pages = max(1, (len(filtered) + UI_PAGE - 1) // UI_PAGE)
        self.page = min(self.page, pages - 1)
        start = self.page * UI_PAGE
        rows = [row_view(record, self.active_id) for record in filtered[start : start + UI_PAGE]]
        active = self.record(self.active_id)
        selected = self.record(self.selected_id)
        focus = selected or active
        locked = printing or self.phase != "ready"
        can_set = (
            not locked
            and selected is not None
            and not (self.active_known and selected["id"] == self.active_id)
        )
        can_clear = not locked and self.active_known and self.active_id is not None
        can_unload = not locked and bool(unload_macros)
        return {
            "phase": self.phase,
            "message": self._message(filtered),
            "help": self.message if self.phase in ("absent", "offline", "hidden", "error") else "",
            "printerKey": self.printer_key,
            "printerLabel": printer_label,
            "connected": self.connected is True,
            "paging": self._paging,
            "activeKnown": self.active_known,
            "activeId": self.active_id,
            "activeText": self._active_text(active),
            "focus": row_view(focus, self.active_id) if focus else None,
            "rows": rows,
            "count": len(self.spools),
            "matched": len(filtered),
            "page": self.page,
            "pages": pages,
            "range": "" if not filtered else f"{start + 1}–{start + len(rows)} of {len(filtered)}",
            "search": self.search,
            "material": self.material,
            "vendor": self.vendor,
            "status": self.status,
            "color": self.color,
            "materials": materials,
            "vendors": vendors,
            "moreMaterials": more_materials,
            "moreVendors": more_vendors,
            "canSet": can_set,
            "canClear": can_clear,
            "canUnload": can_unload,
            "locked": printing,
            "lockReason": "A print is active on this printer. Spool changes stay locked until it finishes." if printing else "",
            "unloadMacros": [{"name": item["name"]} for item in unload_macros if item.get("name")],
            "unloadHint": (
                "Choose the macro that unloads filament on this printer. LAYR does not assume a macro name. "
                "The active spool is cleared only if Klipper accepts that macro. A failed, cancelled, or unanswered run keeps it."
            ),
            "selectedId": self.selected_id,
        }

    def home_chip(self) -> dict:
        if self.phase not in ("ready", "absent", "offline", "error", "loading"):
            return {"visible": False, "text": "", "color": ""}
        if self.phase == "absent":
            return {"visible": True, "text": "Spoolman is not enabled", "color": ""}
        if self.phase == "offline":
            return {"visible": True, "text": "Spoolman is offline", "color": ""}
        if self.phase == "error":
            return {"visible": True, "text": "Spoolman needs attention", "color": ""}
        if self.phase == "loading" and not self.spools:
            return {"visible": True, "text": "Reading Spoolman…", "color": ""}
        if not self.active_known:
            return {"visible": True, "text": "Active spool unknown", "color": ""}
        if self.active_id is None:
            return {"visible": True, "text": "No active spool", "color": ""}
        record = self.record(self.active_id)
        if record is None:
            return {"visible": True, "text": f"Active spool #{self.active_id}", "color": ""}
        row = row_view(record, self.active_id)
        extra = f" · {row['remaining']} left" if row["remaining"] else ""
        return {"visible": True, "text": f"{row['name']}{extra}", "color": row["color"]}

    def _active_text(self, active: dict | None) -> str:
        if not self.active_known:
            return "Active spool has not been read yet"
        if self.active_id is None:
            return "No active spool"
        if active is None:
            return f"Active spool #{self.active_id} is not in this list"
        row = row_view(active, self.active_id)
        bits = [row["name"]]
        if row["material"]:
            bits.append(row["material"])
        if row["vendor"]:
            bits.append(row["vendor"])
        return " · ".join(bits)

    def _message(self, filtered: list[dict]) -> str:
        if self.phase == "ready" and self.spools and not filtered:
            return "No spools match these filters."
        if self.phase == "ready" and not self.spools:
            return "Spoolman has no spools."
        if self.phase == "loading" and not self.spools:
            return "Reading spools from this printer…"
        return self.message if self.phase != "ready" else ""

    def _clear_catalog(self) -> None:
        self.spools = []
        self.images = {}
        self.rejected_images = 0
        self.page = 0
        self._paging = False
