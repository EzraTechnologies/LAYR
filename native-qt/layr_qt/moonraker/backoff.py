"""Bounded exponential reconnect delay. Matches the Svelte client's behaviour."""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass
class BackoffOptions:
    initial_ms: int = 1000
    max_ms: int = 30_000
    factor: float = 2
    jitter: float = 0.2


class Backoff:
    def __init__(self, options: BackoffOptions | None = None, rng: random.Random | None = None) -> None:
        self.options = options or BackoffOptions()
        if self.options.initial_ms <= 0 or self.options.max_ms < self.options.initial_ms or self.options.factor < 1:
            raise ValueError("Invalid backoff options")
        self.options.jitter = min(max(self.options.jitter, 0), 1)
        self._rng = rng or random.Random()
        self.attempt = 0

    def next_ms(self) -> int:
        exp = min(self.attempt, 32)
        base = min(self.options.max_ms, self.options.initial_ms * (self.options.factor**exp))
        self.attempt += 1
        delay = base - base * self.options.jitter * self._rng.random()
        return max(0, round(delay))

    def reset(self) -> None:
        self.attempt = 0
