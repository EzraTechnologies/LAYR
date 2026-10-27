"""Moonraker URL checks. Credentials are rejected so they cannot be stored or logged."""

from __future__ import annotations

from urllib.parse import quote, urlsplit, urlunsplit

DEFAULT_MOONRAKER_URL = "http://localhost:7125"


def validate_moonraker_url(value: str) -> str | None:
    """Return a normalised http(s) base URL, or None when the value is unsafe."""
    raw = value.strip()
    if not raw or any(ord(ch) < 32 for ch in raw):
        return None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https", "ws", "wss"):
        return None
    if parts.username or parts.password:
        return None
    if not parts.hostname:
        return None
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        return None
    scheme = "https" if parts.scheme in ("https", "wss") else "http"
    host = parts.hostname
    if ":" in host:
        host = f"[{host}]"
    port = f":{parts.port}" if parts.port else ""
    return f"{scheme}://{host}{port}"


def websocket_url(base: str, token: str | None = None) -> str | None:
    normalised = validate_moonraker_url(base)
    if normalised is None:
        return None
    parts = urlsplit(normalised)
    scheme = "wss" if parts.scheme == "https" else "ws"
    query = ""
    if token:
        if any(ord(ch) < 32 for ch in token) or " " in token:
            return None
        query = "token=" + quote(token, safe="")
    return urlunsplit((scheme, parts.netloc, "/websocket", query, ""))


def oneshot_token_url(base: str) -> str | None:
    normalised = validate_moonraker_url(base)
    if normalised is None:
        return None
    return normalised + "/access/oneshot_token"


def http_base(base: str) -> str | None:
    return validate_moonraker_url(base)
