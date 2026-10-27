"""Thumbnail URL checks and a localhost redirect refusal."""

from __future__ import annotations

import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from layr_qt.fixture import rgb_png
from layr_qt.httpapi import fetch_bytes, thumbnail_url
from urllib.error import HTTPError, URLError


PNG = rgb_png(2, 2, (62, 224, 240))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/server/files/gcodes/ok.png"):
            body = PNG
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", "http://127.0.0.1:9/elsewhere")
            self.end_headers()
            return
        if self.path.startswith("/html"):
            body = b"<html></html>"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:
        return


class HttpTests(unittest.TestCase):
    def test_thumbnail_url_rejects_escape(self) -> None:
        self.assertEqual(
            thumbnail_url("http://localhost:7125", "jobs/.thumbs/a.png"),
            "http://localhost:7125/server/files/gcodes/jobs/.thumbs/a.png",
        )
        self.assertIsNone(thumbnail_url("http://localhost:7125", "../secret"))
        self.assertIsNone(thumbnail_url("http://localhost:7125", "http://evil/a.png"))

    def test_fetch_accepts_png_and_rejects_html(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(timeout=2)))
        base = f"http://127.0.0.1:{server.server_address[1]}"
        data = fetch_bytes(base + "/server/files/gcodes/ok.png")
        self.assertTrue(data.startswith(b"\x89PNG"))
        with self.assertRaises(URLError):
            fetch_bytes(base + "/html")

    def test_cross_host_redirect_is_refused(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(timeout=2)))
        # The handler redirects to port 9, a different origin from this server.
        url = f"http://127.0.0.1:{server.server_address[1]}/redirect"
        with self.assertRaises((HTTPError, URLError)):
            fetch_bytes(url)


if __name__ == "__main__":
    unittest.main()
