"""Bounded exponential backoff for Moonraker reconnects."""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class BackoffOptions:
    initial_ms: int = 1000
    max_ms: int = 30_000
    factor: float = 2.0
    jitter: float = 0.2


class Backoff:
    """Delays grow as initial_ms * factor^n and never exceed max_ms."""

    def __init__(self, options: BackoffOptions | None = None, rng: random.Random | None = None) -> None:
        self.options = options or BackoffOptions()
        if self.options.initial_ms <= 0 or self.options.max_ms < self.options.initial_ms or self.options.factor < 1:
            raise ValueError("Invalid backoff options")
        self._jitter = min(max(self.options.jitter, 0.0), 1.0)
        self._rng = rng or random.Random()
        self._attempt = 0

    @property
    def attempt(self) -> int:
        return self._attempt

    def next_ms(self) -> int:
        opts = self.options
        exp = min(self._attempt, 32)
        base = min(opts.max_ms, opts.initial_ms * (opts.factor**exp))
        self._attempt += 1
        delay = base - base * self._jitter * self._rng.random()
        return max(0, round(delay))

    def reset(self) -> None:
        self._attempt = 0
