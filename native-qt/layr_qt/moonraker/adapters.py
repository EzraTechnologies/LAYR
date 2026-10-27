"""Future Moonraker ports for Spoolman and an MMU.

Nothing in this module is called by the running UI. The methods are not on the
read allow-list, so the session cannot send them. Spoolman stays the next
product priority (issue 5). AFC / Happy Hare (issue 4) is not implemented.
"""

from __future__ import annotations

from typing import Protocol

from layr_qt.moonraker.protocol import READ_METHODS

# Moonraker Spoolman component. Writes must go through a confirmed command
# path, the same rule as ``src/lib/spoolman/types.ts``.
SPOOLMAN_READS = frozenset({"server.spoolman.get_spool_id", "server.spoolman.proxy", "server.spoolman.status"})
SPOOLMAN_WRITES = frozenset({"server.spoolman.post_spool_id"})


def spoolman_list_request() -> dict:
    """Shape of a future ``server.spoolman.proxy`` GET of ``/v1/spool``. Not sent."""
    return {"method": "server.spoolman.proxy", "params": {"request_method": "GET", "path": "/v1/spool"}}


def spoolman_active_request() -> dict:
    return {"method": "server.spoolman.get_spool_id", "params": {}}


def spoolman_set_active_request(spool_id: int | None) -> dict:
    return {"method": "server.spoolman.post_spool_id", "params": {"spool_id": spool_id}}


class SpoolmanPort(Protocol):
    """Same workflow as the TypeScript contract. Not implemented in this prototype."""

    def list_spools(self, printer_id: str) -> list[dict]: ...

    def get_active_spool(self, printer_id: str) -> dict | None: ...

    def set_active_spool(self, printer_id: str, spool_id: int) -> None: ...

    def clear_active_spool_after_unload(self, printer_id: str, outcome: str) -> None: ...


class SpoolmanNotReady:
    """Placeholder so a later screen can depend on the port without sending RPCs."""

    def list_spools(self, printer_id: str) -> list[dict]:
        raise NotImplementedError("Spoolman is not part of the Qt prototype")

    def get_active_spool(self, printer_id: str) -> dict | None:
        raise NotImplementedError("Spoolman is not part of the Qt prototype")

    def set_active_spool(self, printer_id: str, spool_id: int) -> None:
        raise NotImplementedError("Spoolman is not part of the Qt prototype")

    def clear_active_spool_after_unload(self, printer_id: str, outcome: str) -> None:
        if outcome != "confirmed-success":
            return
        raise NotImplementedError("Spoolman is not part of the Qt prototype")


def mmu_object_names(available: list[str]) -> list[str]:
    """Klipper objects a later MMU adapter might subscribe to.

    Happy Hare commonly exposes ``mmu``. AFC (Armored Turtle) builds often expose
    names that start with ``AFC`` or ``afc``. Exact names differ by install, so
    this only classifies ``printer.objects.list``. It does not subscribe.
    """
    found: list[str] = []
    for name in available:
        lowered = name.lower()
        if lowered == "mmu" or lowered.startswith("mmu ") or lowered.startswith("afc") or name.startswith("AFC"):
            found.append(name)
    return found


def prototype_cannot_call_spoolman_or_mmu() -> bool:
    blocked = SPOOLMAN_READS | SPOOLMAN_WRITES | {"printer.gcode.script", "printer.print.start", "printer.mmu.*"}
    return READ_METHODS.isdisjoint(blocked)
