"""Thumbnail downloads. JSON-RPC stays on the WebSocket.

Only http(s) URLs on the configured Moonraker host are fetched, and only for
a path that has already been confined to the gcodes root.
"""

from __future__ import annotations

from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .paths import gcodes_http_path
from .urls import to_http_url

MAX_THUMB_BYTES = 2_000_000
PNG = b"\x89PNG\r\n\x1a\n"
JPEG = b"\xff\xd8\xff"


class _SameHostRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        original = urlsplit(req.full_url)
        target = urlsplit(newurl)
        if target.scheme not in {"http", "https"} or target.netloc != original.netloc:
            raise HTTPError(newurl, code, "Refusing cross-host thumbnail redirect", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def thumbnail_url(base_url: str, relative_path: str) -> str | None:
    path = gcodes_http_path(relative_path)
    if path is None:
        return None
    url = to_http_url(base_url, path)
    parts = urlsplit(url)
    base = urlsplit(to_http_url(base_url, "/"))
    if parts.scheme not in {"http", "https"} or parts.netloc != base.netloc:
        return None
    if not parts.path.startswith("/server/files/gcodes/"):
        return None
    return url


def fetch_bytes(url: str, api_key: str | None = None, timeout: float = 10) -> bytes:
    headers = {"User-Agent": "LAYR-Qt"}
    if api_key:
        headers["X-Api-Key"] = api_key
    request = Request(url, headers=headers)
    opener = build_opener(_SameHostRedirect)
    with opener.open(request, timeout=timeout) as response:
        data = response.read(MAX_THUMB_BYTES + 1)
    if len(data) > MAX_THUMB_BYTES:
        raise URLError("Thumbnail exceeded size limit")
    if not data.startswith(PNG) and not data.startswith(JPEG):
        raise URLError("Thumbnail is not a PNG or JPEG")
    return data
