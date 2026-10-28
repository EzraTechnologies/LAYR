"""One in-flight command per group. Confirmation is required before a send.

Emergency stop is never queued behind another group. Success is not decided here:
the session reports a reply, a failure, or an unconfirmed timeout.
"""

from __future__ import annotations

from layr_qt.actions.commands import ESTOP_GROUP, prepare_command


def clean_klipper_message(message: str) -> str:
    """Klipper errors arrive as ``!! Must home axis first...``."""
    text = (message or "").strip()
    if text.startswith("!!"):
        text = text[2:].strip()
    return text or "The printer rejected the command"


class CommandGateway:
    def __init__(self) -> None:
        self.inflight: set[str] = set()

    def begin(self, command: dict, state: dict, *, confirmed: bool = False) -> dict:
        prepared = prepare_command(command, state)
        if not prepared["ok"]:
            return {"status": "blocked", "message": prepared["message"]}
        plan = prepared["plan"]
        group = plan["group"]
        if group != ESTOP_GROUP and group in self.inflight:
            return {"status": "busy", "message": "Still waiting for the previous command"}
        if plan.get("confirm") and not confirmed:
            return {"status": "needs_confirmation", "confirm": plan["confirm"], "command": command}
        if group != ESTOP_GROUP:
            self.inflight.add(group)
        return {"status": "sending", "plan": plan}

    def release(self, group: str) -> None:
        self.inflight.discard(group)
