"""G-code paths and thumbnail URLs that cannot leave the Moonraker files root."""

from __future__ import annotations

from urllib.parse import quote

from layr_qt.moonraker.telemetry import config_number
from layr_qt.moonraker.urls import http_base

GCODE_EXTENSIONS = (".gcode", ".gco", ".g", ".ufp")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg")
MAX_THUMBNAIL_BYTES = 2_000_000


def safe_relative(path: object) -> str | None:
    if not isinstance(path, str):
        return None
    if "\\" in path or "\x00" in path or "://" in path or path.startswith("/"):
        return None
    out: list[str] = []
    for piece in path.split("/"):
        if piece in ("", "."):
            continue
        if piece == "..":
            if not out:
                return None
            out.pop()
            continue
        if "\x00" in piece:
            return None
        out.append(piece)
    return "/".join(out)


def parent_dir(path: str) -> str:
    if "/" not in path:
        return ""
    return path.rsplit("/", 1)[0]


def gcode_name(path: str) -> bool:
    lower = path.lower()
    return lower.endswith(GCODE_EXTENSIONS)


def safe_gcode_filename(path: object) -> str | None:
    relative = safe_relative(path)
    if relative is None or not relative or not gcode_name(relative):
        return None
    if len(relative) > 512:
        return None
    return relative


def gcodes_api_path(relative: object) -> str | None:
    """Moonraker directory argument: ``gcodes`` or ``gcodes/<folder>``."""
    if relative is None:
        relative = ""
    if not isinstance(relative, str):
        return None
    if relative.strip() == "":
        return "gcodes"
    folder = safe_relative(relative)
    if folder is None:
        return None
    return "gcodes" if folder == "" else "gcodes/" + folder


def encode_path(path: str) -> str:
    return "/".join(quote(segment, safe="") for segment in path.split("/"))


def thumbnail_request_url(base: str, relative: object) -> str | None:
    root = http_base(base)
    path = safe_relative(relative)
    if root is None or path is None or not path:
        return None
    if not path.lower().endswith(IMAGE_EXTENSIONS):
        return None
    if len(path) > 512:
        return None
    return f"{root}/server/files/gcodes/{encode_path(path)}"


def image_kind(data: bytes) -> str | None:
    if not isinstance(data, (bytes, bytearray)):
        return None
    blob = bytes(data)
    if len(blob) < 8 or len(blob) > MAX_THUMBNAIL_BYTES:
        return None
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if blob.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    return None


def map_thumbnails(file_path: str, thumbs: object) -> list[dict]:
    if not isinstance(thumbs, list):
        return []
    directory = parent_dir(file_path)
    mapped: list[dict] = []
    for entry in thumbs:
        if not isinstance(entry, dict):
            continue
        relative = entry.get("relative_path")
        if not isinstance(relative, str) or not relative:
            continue
        path = safe_relative(f"{directory}/{relative}" if directory else relative)
        if path is None or not path.lower().endswith(IMAGE_EXTENSIONS):
            continue
        width = config_number(entry.get("width")) or 0
        height = config_number(entry.get("height")) or 0
        mapped.append({"width": width, "height": height, "path": path})
    return mapped


def pick_thumbnail(thumbs: list[dict], min_width: float) -> dict | None:
    if not thumbs:
        return None
    ordered = sorted(thumbs, key=lambda item: item.get("width") or 0)
    for thumb in ordered:
        if (thumb.get("width") or 0) >= min_width:
            return thumb
    return ordered[-1]


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def map_metadata(file_path: str, meta: dict) -> dict:
    slicer = _text(meta.get("slicer"))
    version = _text(meta.get("slicer_version"))
    return {
        "estimatedTime": config_number(meta.get("estimated_time")),
        "filamentTotal": config_number(meta.get("filament_total")),
        "filamentType": _text(meta.get("filament_type")),
        "slicer": " ".join(part for part in (slicer, version) if part) or None,
        "thumbnails": map_thumbnails(file_path, meta.get("thumbnails")),
    }


def _has_metadata(file: dict) -> bool:
    return "estimated_time" in file or "thumbnails" in file or "slicer" in file


def map_directory(directory: str, result: dict) -> dict:
    folder = safe_relative(directory) if directory else ""
    if directory and folder is None:
        return {"dirs": [], "files": []}
    dirs: list[dict] = []
    for entry in result.get("dirs") or []:
        if not isinstance(entry, dict):
            continue
        name = _text(entry.get("dirname"))
        if not name or name.startswith(".") or "/" in name or "\\" in name:
            continue
        path = safe_relative(f"{folder}/{name}" if folder else name)
        if path is None:
            continue
        dirs.append({"path": path, "name": name, "modified": config_number(entry.get("modified"))})
    files: list[dict] = []
    for entry in result.get("files") or []:
        if not isinstance(entry, dict):
            continue
        name = _text(entry.get("filename"))
        if not name or name.startswith(".") or not gcode_name(name) or "/" in name:
            continue
        path = safe_relative(f"{folder}/{name}" if folder else name)
        if path is None:
            continue
        files.append(
            {
                "path": path,
                "name": name,
                "modified": config_number(entry.get("modified")),
                "size": config_number(entry.get("size")),
                "meta": map_metadata(path, entry) if _has_metadata(entry) else None,
            }
        )
    dirs.sort(key=lambda item: item["name"].lower())
    return {"dirs": dirs, "files": files}
