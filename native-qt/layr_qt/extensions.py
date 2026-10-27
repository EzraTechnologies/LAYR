"""Future Moonraker adapters. Not called by the prototype.

Spoolman (issue #5) and AFC / Happy Hare (issue #4) should sit behind the
same read allow-list and a later confirmation gate. They are described in
docs/integration.md and are not implemented here.
"""

from __future__ import annotations

from typing import Protocol

# Read methods the Qt client may send. Host control, G-code, and Spoolman writes
# are absent on purpose.
READ_METHODS = frozenset(
    {
        "server.connection.identify",
        "server.info",
        "printer.info",
        "printer.objects.list",
        "printer.objects.query",
        "printer.objects.subscribe",
        "server.files.get_directory",
        "server.files.metadata",
        "server.files.thumbnails",
    }
)

# Kept here so tests can prove the client refuses them.
REJECTED_METHODS = frozenset(
    {
        "printer.gcode.script",
        "printer.print.start",
        "printer.print.pause",
        "printer.print.resume",
        "printer.print.cancel",
        "printer.emergency_stop",
        "printer.restart",
        "printer.firmware_restart",
        "server.files.delete_file",
        "server.restart",
        "machine.reboot",
        "machine.shutdown",
        "server.spoolman.proxy",
        "server.spoolman.get_spool_id",
        "server.spoolman.post_spool_id",
    }
)

SPOOLMAN_METHODS = (
    "server.spoolman.proxy",
    "server.spoolman.get_spool_id",
    "server.spoolman.post_spool_id",
)

# Object names a later subscription planner can opt into. Not subscribed now.
MMU_OBJECT_CANDIDATES = ("mmu", "mmu_machine", "AFC", "afc")


def is_allowed_method(method: str) -> bool:
    return method in READ_METHODS


class SpoolmanService(Protocol):
    """Same contract as src/lib/spoolman/types.ts. Do not implement in this prototype."""

    def list_spools(self, printer_id: str) -> list[dict[str, object]]: ...

    def get_active_spool(self, printer_id: str) -> dict[str, object] | None: ...

    def set_active_spool(self, printer_id: str, spool_id: int) -> None: ...

    def clear_active_spool_after_unload(self, printer_id: str, outcome: str) -> None: ...
