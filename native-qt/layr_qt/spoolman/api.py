"""Moonraker Spoolman requests, response parsing, and image guards.

Contracts checked against Moonraker's documented JSON-RPC methods
(``server.spoolman.status``, ``server.spoolman.get_spool_id``,
``server.spoolman.post_spool_id``, ``server.spoolman.proxy`` with
``use_v2_response``) and Spoolman's ``GET /v1/spool`` object.

Images are taken only from bytes already inside that JSON. URLs are ignored
so the panel cannot be pointed at another host.
"""

from __future__ import annotations

import base64
import re
from typing import Any

from layr_qt.moonraker.files import image_kind

LIST_LIMIT = 100
MAX_LIST_OFFSET = 1900
MAX_SPOOL_ID = 1_000_000_000
UI_PAGE = 40
MAX_SPOOL_IMAGE_BYTES = 256_000
MAX_ENCODED_IMAGE = 350_000
IMAGE_KEYS = ("photo", "image", "picture", "spool_image")
HEX_RE = re.compile(r"^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")
DETAIL_PATH_RE = re.compile(r"^/v1/spool/([1-9][0-9]{0,8})$")
LIST_QUERY_RE = re.compile(r"^allow_archived=true&limit=100&offset=(\d+)$")
DATA_URL_RE = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$", re.IGNORECASE)
SPOOLMAN_READS = frozenset({"server.spoolman.get_spool_id", "server.spoolman.proxy", "server.spoolman.status"})
SPOOLMAN_WRITES = frozenset({"server.spoolman.post_spool_id"})

STATUS_FILTERS = ("available", "all", "archived", "empty", "active")
COLOR_FILTERS = ("", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "white", "black", "grey")


def should_clear_after_unload(outcome: str) -> bool:
    """Clear only after Klipper has accepted the unload. Anything else keeps the spool."""
    return outcome == "confirmed-success"


def unload_outcome(status: str) -> str:
    if status == "ok":
        return "confirmed-success"
    if status == "failed":
        return "failed"
    if status == "cancelled":
        return "cancelled"
    return "unconfirmed"


def spool_id_value(value: object, *, allow_none: bool = False) -> int | None:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("spool id")
    if value < 1 or value > MAX_SPOOL_ID:
        raise ValueError("spool id")
    return value


def list_query(offset: int) -> str:
    if isinstance(offset, bool) or not isinstance(offset, int):
        raise ValueError("offset")
    if offset < 0 or offset > MAX_LIST_OFFSET or offset % LIST_LIMIT != 0:
        raise ValueError("offset")
    return f"allow_archived=true&limit={LIST_LIMIT}&offset={offset}"


def _list_query_ok(query: object) -> bool:
    if not isinstance(query, str):
        return False
    match = LIST_QUERY_RE.fullmatch(query)
    if match is None:
        return False
    raw = match.group(1)
    offset = int(raw)
    if raw != str(offset):
        return False
    try:
        return query == list_query(offset)
    except ValueError:
        return False


def proxy_params(path: str, query: str | None = None) -> dict:
    params: dict[str, Any] = {
        "use_v2_response": True,
        "request_method": "GET",
        "path": path,
    }
    if query is not None:
        params["query"] = query
    if not spoolman_proxy_allowed(params):
        raise ValueError("proxy")
    return params


def spoolman_status_request() -> dict:
    return {"method": "server.spoolman.status", "params": {}}


def spoolman_list_request(offset: int = 0) -> dict:
    return {"method": "server.spoolman.proxy", "params": proxy_params("/v1/spool", list_query(offset))}


def spoolman_detail_request(spool_id: int) -> dict:
    spool_id_value(spool_id)
    return {"method": "server.spoolman.proxy", "params": proxy_params(f"/v1/spool/{spool_id}")}


def spoolman_active_request() -> dict:
    return {"method": "server.spoolman.get_spool_id", "params": {}}


def spoolman_set_active_request(spool_id: int | None) -> dict:
    spool_id_value(spool_id, allow_none=True)
    return {"method": "server.spoolman.post_spool_id", "params": {"spool_id": spool_id}}


def spoolman_proxy_allowed(params: object) -> bool:
    if not isinstance(params, dict):
        return False
    if set(params) - {"use_v2_response", "request_method", "path", "query"}:
        return False
    if params.get("use_v2_response") is not True or params.get("request_method") != "GET":
        return False
    path = params.get("path")
    if not isinstance(path, str) or ".." in path or "\\" in path or "%" in path or "://" in path:
        return False
    query = params.get("query", None)
    if path == "/v1/spool":
        return _list_query_ok(query)
    match = DETAIL_PATH_RE.fullmatch(path)
    if match is None or query not in (None, ""):
        return False
    try:
        spool_id_value(int(match.group(1)))
    except ValueError:
        return False
    return match.group(1) == str(int(match.group(1)))


def spoolman_write_allowed(params: object) -> bool:
    if not isinstance(params, dict) or set(params) != {"spool_id"}:
        return False
    try:
        spool_id_value(params.get("spool_id"), allow_none=True)
    except ValueError:
        return False
    return True


def absent_message(text: str) -> bool:
    lowered = (text or "").lower()
    tokens = ("not found", "unknown method", "unregistered", "no module", "method not found")
    return any(token in lowered for token in tokens)


def parse_status(result: object) -> dict:
    if not isinstance(result, dict):
        return {"ok": False, "absent": False, "connected": False, "error": "Unexpected Spoolman status", "activeKnown": False, "spoolId": None}
    connected = result.get("spoolman_connected")
    known, spool_id = _optional_id(result, "spool_id")
    return {
        "ok": True,
        "absent": False,
        "connected": connected is True,
        "error": "",
        "activeKnown": known,
        "spoolId": spool_id,
    }


def parse_active(result: object) -> dict:
    if not isinstance(result, dict) or "spool_id" not in result:
        return {"ok": False, "error": "Spoolman did not return an active spool", "activeKnown": False, "spoolId": None}
    known, spool_id = _optional_id(result, "spool_id")
    if not known:
        return {"ok": False, "error": "Spoolman returned an unusable spool id", "activeKnown": False, "spoolId": None}
    return {"ok": True, "error": "", "activeKnown": True, "spoolId": spool_id}


def _optional_id(payload: dict, key: str) -> tuple[bool, int | None]:
    if key not in payload:
        return False, None
    value = payload.get(key)
    if value is None:
        return True, None
    try:
        return True, spool_id_value(value)
    except ValueError:
        return False, None


def ingest_proxy(result: object) -> dict:
    """Unwrap a version-2 proxy body. Version 1 lists are accepted for the same GET."""
    payload, error = _unwrap(result)
    if error:
        return {"ok": False, "offline": error == "offline", "error": error if error != "offline" else "Spoolman is not reachable", "received": 0, "spools": [], "images": {}, "rejected": 0}
    spools, images, rejected, received = _parse_collection(payload)
    return {"ok": True, "offline": False, "error": "", "received": received, "spools": spools, "images": images, "rejected": rejected}


def _unwrap(result: object) -> tuple[object, str]:
    if isinstance(result, list):
        return result, ""
    if not isinstance(result, dict):
        return None, "Unexpected Spoolman response"
    error = result.get("error")
    if error:
        message = error.get("message") if isinstance(error, dict) else str(error)
        message = message or "Spoolman error"
        code = error.get("status_code") if isinstance(error, dict) else None
        if code == 503 or "not available" in message.lower():
            return None, "offline"
        return None, message
    if "response" in result:
        return result.get("response"), ""
    if "id" in result and "filament" in result:
        return result, ""
    return None, "Unexpected Spoolman response"


def _parse_collection(payload: object) -> tuple[list[dict], dict[str, bytes], int, int]:
    if isinstance(payload, list):
        raw_items = [item for item in payload if isinstance(item, dict)]
        received = len(payload)
    elif isinstance(payload, dict) and "id" in payload:
        raw_items = [payload]
        received = 1
    elif payload is None:
        return [], {}, 0, 0
    else:
        return [], {}, 0, 0
    spools: list[dict] = []
    images: dict[str, bytes] = {}
    rejected = 0
    for item in raw_items:
        parsed = _parse_spool(item)
        if parsed is None:
            continue
        record, image, rejected_one = parsed
        rejected += rejected_one
        spools.append(record)
        if image is not None:
            images[record["imageKey"]] = image
    return spools, images, rejected, received


def _parse_spool(item: dict) -> tuple[dict, bytes | None, int] | None:
    try:
        spool_id = spool_id_value(item.get("id"))
    except ValueError:
        return None
    filament = item.get("filament") if isinstance(item.get("filament"), dict) else {}
    vendor = filament.get("vendor") if isinstance(filament.get("vendor"), dict) else {}
    colors = _colors(filament.get("color_hex"), filament.get("multi_color_hexes"))
    image, rejected = _image_from(item, filament)
    record = {
        "id": spool_id,
        "name": _text(filament.get("name")) or f"Spool {spool_id}",
        "vendor": _text(vendor.get("name")),
        "material": _text(filament.get("material")),
        "colors": colors,
        "buckets": [color_bucket(color) for color in colors],
        "remaining": _grams(item.get("remaining_weight")),
        "used": _grams(item.get("used_weight")),
        "total": _grams(filament.get("weight")),
        "archived": item.get("archived") is True,
        "location": _text(item.get("location")),
        "lot": _text(item.get("lot_nr")),
        "comment": _text(item.get("comment"))[:300],
        "imageKey": f"spool/{spool_id}" if image is not None else "",
    }
    return record, image, rejected


def _text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())


def _grams(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number < 0 or number != number or number == float("inf"):
        return None
    return number


def _colors(single: object, multi: object) -> list[str]:
    found: list[str] = []
    if isinstance(multi, str) and multi.strip():
        for piece in multi.split(","):
            color = _css_color(piece.strip())
            if color and color not in found:
                found.append(color)
    if not found:
        color = _css_color(single if isinstance(single, str) else "")
        if color:
            found.append(color)
    return found[:6]


def _css_color(value: str) -> str:
    token = value[1:] if value.startswith("#") else value
    if not HEX_RE.fullmatch(token):
        return ""
    return "#" + token[:6].lower()


def color_bucket(css: str) -> str:
    hex6 = css[1:]
    red = int(hex6[0:2], 16)
    green = int(hex6[2:4], 16)
    blue = int(hex6[4:6], 16)
    high = max(red, green, blue)
    low = min(red, green, blue)
    if high < 40:
        return "black"
    if low > 220 and high - low < 25:
        return "white"
    if high - low < 18:
        return "grey"
    span = high - low
    if high == red:
        hue = (green - blue) / span
    elif high == green:
        hue = 2 + (blue - red) / span
    else:
        hue = 4 + (red - green) / span
    hue *= 60
    if hue < 0:
        hue += 360
    if hue < 20 or hue >= 345:
        return "red"
    if hue < 45:
        return "orange"
    if hue < 70:
        return "yellow"
    if hue < 160:
        return "green"
    if hue < 200:
        return "cyan"
    if hue < 255:
        return "blue"
    return "purple"


def _image_from(spool: dict, filament: dict) -> tuple[bytes | None, int]:
    rejected = 0
    for source in (spool.get("extra"), filament.get("extra")):
        if not isinstance(source, dict):
            continue
        for key, value in source.items():
            if str(key).lower() not in IMAGE_KEYS:
                continue
            image, bad = _decode_image(value)
            rejected += bad
            if image is not None:
                return image, rejected
    return None, rejected


def _decode_image(value: object) -> tuple[bytes | None, int]:
    if isinstance(value, dict):
        if any(token in str(value.get("url") or "") for token in ("://", "//")):
            return None, 1
        mime = str(value.get("mime") or value.get("content_type") or "")
        if mime and mime.lower() not in ("image/png", "image/jpeg"):
            return None, 1
        return _decode_image(value.get("content") or value.get("data"))
    if not isinstance(value, str):
        return None, 0
    text = "".join(value.split())
    if not text:
        return None, 0
    lowered = text.lower()
    if "://" in lowered or lowered.startswith("//") or lowered.startswith("file:") or lowered.startswith("javascript:"):
        return None, 1
    encoded = text
    if lowered.startswith("data:"):
        match = DATA_URL_RE.fullmatch(text)
        if match is None:
            return None, 1
        encoded = match.group(2)
    elif not re.fullmatch(r"[A-Za-z0-9+/=]+", text):
        return None, 1
    if len(encoded) > MAX_ENCODED_IMAGE:
        return None, 1
    try:
        blob = base64.b64decode(encoded, validate=True)
    except ValueError:
        return None, 1
    if len(blob) > MAX_SPOOL_IMAGE_BYTES or image_kind(blob) is None:
        return None, 1
    return bytes(blob), 0


def spool_status(record: dict) -> str:
    if record.get("archived"):
        return "archived"
    remaining = record.get("remaining")
    if remaining == 0:
        return "empty"
    return "available"


def format_grams(value: float | None) -> str:
    if value is None:
        return ""
    if value >= 100 or abs(value - round(value)) < 0.05:
        return f"{round(value):.0f} g"
    return f"{value:.1f} g"


def weight_line(record: dict) -> str:
    remaining = format_grams(record.get("remaining"))
    used = format_grams(record.get("used"))
    total = format_grams(record.get("total"))
    parts = []
    if remaining:
        parts.append(f"{remaining} left")
    if used and total:
        parts.append(f"{used} used · {total} spool")
    elif used:
        parts.append(f"{used} used")
    elif total:
        parts.append(f"{total} spool")
    return " · ".join(parts) or "Weight not reported"


def row_view(record: dict, active_id: int | None) -> dict:
    colors = list(record.get("colors") or [])
    return {
        "id": record["id"],
        "name": record["name"],
        "vendor": record.get("vendor") or "",
        "material": record.get("material") or "",
        "color": colors[0] if colors else "",
        "colors": colors,
        "remaining": format_grams(record.get("remaining")),
        "used": format_grams(record.get("used")),
        "total": format_grams(record.get("total")),
        "weightLine": weight_line(record),
        "active": active_id is not None and record["id"] == active_id,
        "archived": bool(record.get("archived")),
        "imageKey": record.get("imageKey") or "",
        "location": record.get("location") or "",
        "lot": record.get("lot") or "",
        "comment": record.get("comment") or "",
        "status": spool_status(record),
    }


def matches(record: dict, *, search: str, material: str, vendor: str, status: str, color: str, active_id: int | None) -> bool:
    if material and (record.get("material") or "") != material:
        return False
    if vendor and (record.get("vendor") or "") != vendor:
        return False
    if color and color not in (record.get("buckets") or []):
        return False
    kind = spool_status(record)
    if status == "available" and kind != "available":
        return False
    if status == "archived" and kind != "archived":
        return False
    if status == "empty" and kind != "empty":
        return False
    if status == "active" and record["id"] != active_id:
        return False
    needle = search.strip().lower()
    if not needle:
        return True
    haystack = " ".join(
        [
            record.get("name") or "",
            record.get("vendor") or "",
            record.get("material") or "",
            record.get("location") or "",
            record.get("lot") or "",
            str(record["id"]),
        ]
    ).lower()
    return needle in haystack


def option_list(records: list[dict], key: str, limit: int = 12) -> tuple[list[str], bool]:
    values = sorted({record.get(key) or "" for record in records if record.get(key)})
    return values[:limit], len(values) > limit
