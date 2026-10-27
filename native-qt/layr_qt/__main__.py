"""Launch the native Qt prototype: python3 -m layr_qt"""

from __future__ import annotations

import sys

from .perf import PROCESS_START, PerfLog


def main(argv: list[str] | None = None) -> int:
    # Touch the clock before Qt imports so startup marks include module load.
    _ = PROCESS_START
    from .qt_app import run

    return run(sys.argv[1:] if argv is None else argv)


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["PerfLog", "main"]
