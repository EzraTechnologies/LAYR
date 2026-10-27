"""Safe paths under Moonraker's gcodes root."""

from __future__ import annotations

from urllib.parse import quote

GCODE_SUFFIXES = (".gcode", ".gco", ".g", ".ufp")


def safe_relative_path(value: str) -> str | None:
    """Normalise a gcodes-relative path. `..` cannot escape the root.

    An empty string is the gcodes root. Absolute paths, URLs, backslashes,
    and NUL bytes are rejected.
    """
    if not isinstance(value, str):
        return None
    if "\x00" in value or "\\" in value or "://" in value or value.startswith("/"):
        return None
    out: list[str] = []
    for part in value.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            if not out:
                return None
            out.pop()
            continue
        out.append(part)
    return "/".join(out)


def join_relative(*parts: str) -> str | None:
    # An empty folder means the gcodes root. "/".join(["", "a.png"]) would look absolute.
    return safe_relative_path("/".join(part.strip("/") for part in parts if part))


def parent_dir(path: str) -> str:
    safe = safe_relative_path(path)
    if not safe or "/" not in safe:
        return ""
    return safe.rsplit("/", 1)[0]


def encode_path(path: str) -> str:
    return "/".join(quote(part, safe="") for part in path.split("/"))


def is_gcode_name(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(ext) for ext in GCODE_SUFFIXES)


def gcodes_http_path(relative_path: str) -> str | None:
    safe = safe_relative_path(relative_path)
    if safe is None or safe == "":
        return None
    return f"/server/files/gcodes/{encode_path(safe)}"


def directory_rpc_path(relative_dir: str) -> str | None:
    if relative_dir.strip() == "":
        return "gcodes"
    safe = safe_relative_path(relative_dir)
    if safe is None or safe == "":
        return None
    return f"gcodes/{safe}"
