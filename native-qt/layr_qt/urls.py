"""Moonraker URL checks. Credentials in the URL are rejected."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit


def is_valid_moonraker_url(value: str) -> bool:
    text = value.strip()
    if not text or any(ord(ch) < 32 for ch in text):
        return False
    try:
        parts = urlsplit(text)
    except ValueError:
        return False
    if parts.scheme not in {"http", "https", "ws", "wss"}:
        return False
    if not parts.hostname or parts.username or parts.password:
        return False
    return True


def normalise_base_url(base_url: str) -> str:
    text = base_url.strip().rstrip("/")
    if text.endswith("/websocket"):
        text = text[: -len("/websocket")]
    return text.rstrip("/")


def to_websocket_url(base_url: str) -> str:
    base = normalise_base_url(base_url)
    parts = urlsplit(base)
    if parts.scheme == "http":
        scheme = "ws"
    elif parts.scheme == "https":
        scheme = "wss"
    elif parts.scheme in {"ws", "wss"}:
        scheme = parts.scheme
    else:
        raise ValueError(f"Unsupported Moonraker URL protocol: {parts.scheme}")
    path = parts.path.rstrip("/") + "/websocket"
    return urlunsplit((scheme, parts.netloc, path, parts.query, ""))


def to_http_url(base_url: str, path: str) -> str:
    """Join a Moonraker base URL with an already-encoded path that may include a query."""
    base = normalise_base_url(base_url)
    parts = urlsplit(base)
    if parts.scheme == "ws":
        scheme = "http"
    elif parts.scheme == "wss":
        scheme = "https"
    elif parts.scheme in {"http", "https"}:
        scheme = parts.scheme
    else:
        raise ValueError(f"Unsupported Moonraker URL protocol: {parts.scheme}")
    query_at = path.find("?")
    extra_path = path if query_at == -1 else path[:query_at]
    query = "" if query_at == -1 else path[query_at + 1 :]
    joined = parts.path.rstrip("/") + extra_path
    return urlunsplit((scheme, parts.netloc, joined, query, ""))


def redact_url(url: str) -> str:
    """Drop a oneshot token before anything is written to a log."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [item for item in parts.query.split("&") if not item.startswith("token=")]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "&".join(kept), ""))
