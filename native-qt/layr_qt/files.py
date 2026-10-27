"""G-code directory and thumbnail metadata. No print or delete commands."""

from __future__ import annotations

from typing import Any

from .paths import is_gcode_name, join_relative, parent_dir, safe_relative_path
from .telemetry import config_number


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def map_thumbnails(file_path: str, thumbs: Any) -> list[dict[str, Any]]:
    if not isinstance(thumbs, list):
        return []
    folder = parent_dir(file_path)
    mapped: list[dict[str, Any]] = []
    for thumb in thumbs:
        if not isinstance(thumb, dict):
            continue
        relative = thumb.get("relative_path")
        if not isinstance(relative, str) or not relative:
            continue
        path = join_relative(folder, relative)
        if path is None or path == "":
            continue
        width = config_number(thumb.get("width")) or 0
        height = config_number(thumb.get("height")) or 0
        mapped.append({"width": width, "height": height, "path": path})
    return mapped


def pick_thumbnail(thumbs: list[dict[str, Any]], min_width: float) -> dict[str, Any] | None:
    if not thumbs:
        return None
    sorted_thumbs = sorted(thumbs, key=lambda item: item.get("width") or 0)
    for thumb in sorted_thumbs:
        if (thumb.get("width") or 0) >= min_width:
            return thumb
    return sorted_thumbs[-1]


def map_metadata(file_path: str, meta: dict[str, Any]) -> dict[str, Any]:
    slicer = _text(meta.get("slicer"))
    version = _text(meta.get("slicer_version"))
    return {
        "estimatedTime": config_number(meta.get("estimated_time")),
        "filamentTotal": config_number(meta.get("filament_total")),
        "filamentType": _text(meta.get("filament_type")),
        "layerHeight": config_number(meta.get("layer_height")),
        "slicer": " ".join(part for part in (slicer, version) if part) or None,
        "thumbnails": map_thumbnails(file_path, meta.get("thumbnails")),
    }


def _has_metadata(entry: dict[str, Any]) -> bool:
    return any(key in entry for key in ("estimated_time", "thumbnails", "slicer"))


def map_directory(directory: str, result: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    root = safe_relative_path(directory)
    if root is None:
        return {"dirs": [], "files": []}
    dirs: list[dict[str, Any]] = []
    for entry in result.get("dirs") or []:
        if not isinstance(entry, dict):
            continue
        name = _text(entry.get("dirname"))
        if not name or name.startswith(".") or "/" in name or name == "..":
            continue
        path = join_relative(root, name)
        if path is None:
            continue
        dirs.append({"path": path, "name": name, "modified": config_number(entry.get("modified"))})
    files: list[dict[str, Any]] = []
    for entry in result.get("files") or []:
        if not isinstance(entry, dict):
            continue
        name = _text(entry.get("filename"))
        if not name or name.startswith(".") or not is_gcode_name(name):
            continue
        path = join_relative(root, name)
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
    files.sort(key=lambda item: (-(item["modified"] or -1), item["name"].lower()))
    return {"dirs": dirs, "files": files}
