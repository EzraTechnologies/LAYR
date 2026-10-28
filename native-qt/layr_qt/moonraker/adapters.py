"""Moonraker ports for Spoolman reads and a future MMU.

Spoolman reads are on the session allow-list. Setting the active spool is a
confirmed control write (``server.spoolman.post_spool_id``). AFC / Happy Hare
is not subscribed and has no UI.
"""

from __future__ import annotations

from layr_qt.moonraker.protocol import READ_METHODS
from layr_qt.spoolman.api import (
    SPOOLMAN_READS,
    SPOOLMAN_WRITES,
    spoolman_active_request,
    spoolman_list_request,
    spoolman_set_active_request,
    spoolman_status_request,
)

__all__ = [
    "SPOOLMAN_READS",
    "SPOOLMAN_WRITES",
    "mmu_object_names",
    "read_path_blocks_spoolman_writes_and_mmu",
    "spoolman_active_request",
    "spoolman_list_request",
    "spoolman_set_active_request",
    "spoolman_status_request",
]


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


def read_path_blocks_spoolman_writes_and_mmu() -> bool:
    """Status reads may include Spoolman. Writes and MMU motion stay off that path."""
    blocked = set(SPOOLMAN_WRITES) | {"printer.gcode.script", "printer.print.start", "printer.mmu.*"}
    return READ_METHODS.isdisjoint(blocked) and SPOOLMAN_READS <= READ_METHODS
