"""Async Moonraker session. WebSocket I/O stays out of the state machine."""

from __future__ import annotations

import asyncio
import json
import queue
from typing import Any, Awaitable, Callable, Protocol

from .files import map_directory
from .httpapi import fetch_bytes, thumbnail_url
from .machine import Effect, MoonrakerMachine
from .paths import directory_rpc_path
from .urls import redact_url, to_http_url
from .viewmodel import ViewModel

ConnectFn = Callable[[str], Awaitable["Socket"]]


class Socket(Protocol):
    async def send(self, text: str) -> None: ...

    async def recv(self) -> str: ...

    async def close(self) -> None: ...


class Session:
    def __init__(
        self,
        machine: MoonrakerMachine,
        model: ViewModel,
        connect: ConnectFn,
        publish: Callable[[dict[str, Any]], None],
        publish_files: Callable[[dict[str, Any]], None],
        publish_thumbnail: Callable[[bytes | None], None],
        now: Callable[[], float],
        api_key: str | None = None,
        log: Callable[[str], None] | None = None,
    ) -> None:
        self.machine = machine
        self.model = model
        self.connect = connect
        self.publish = publish
        self.publish_files = publish_files
        self.publish_thumbnail = publish_thumbnail
        self.now = now
        self.api_key = api_key
        self.log = log or (lambda _line: None)
        self._wake = asyncio.Event()
        self._queue: queue.SimpleQueue[tuple[Any, ...]] = queue.SimpleQueue()
        self._socket: Socket | None = None
        self._socket_generation = 0
        self._metadata_inflight: str | None = None
        self._files_open = False
        self._closed = False
        self.loop: asyncio.AbstractEventLoop | None = None

    def submit(self, command: tuple[Any, ...]) -> None:
        self._queue.put(command)
        loop = self.loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(self._wake.set)
        else:
            self._wake.set()

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._dispatch(self.machine.start(self.now()))
        while self.machine.running or self._socket is not None:
            await self._step()
        await asyncio.sleep(0)

    async def _step(self) -> None:
        timeout = self._timeout()
        waiters: list[asyncio.Future[Any]] = [asyncio.ensure_future(self._wake.wait())]
        if self._socket is not None and self.machine.phase == "open":
            waiters.append(asyncio.ensure_future(self._socket.recv()))
        done, pending = await asyncio.wait(waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        for item in pending:
            item.cancel()
        self._wake.clear()
        self._drain_commands()
        for item in done:
            if item is waiters[0]:
                continue
            try:
                text = item.result()
            except Exception as exc:  # socket died
                await self._closed_socket(str(exc) or "Connection closed")
                return
            self._dispatch(self.machine.on_message(self._socket_generation, text, self.now()))
        self._dispatch(self.machine.tick(self.now()))
        self._maybe_metadata()

    def _drain_commands(self) -> None:
        commands: list[tuple[Any, ...]] = []
        while True:
            try:
                commands.append(self._queue.get_nowait())
            except queue.Empty:
                break
        for command in commands:
            kind = command[0]
            if kind == "stop":
                self._dispatch(self.machine.stop(self.now()))
                self._closed = True
            elif kind == "reconnect":
                self._dispatch(self.machine.reconnect(self.now()))
            elif kind == "directory":
                self._request_directory(str(command[1]))
            elif kind == "url":
                self.machine.base_url = str(command[1])
                self.model.moonraker_url = str(command[1])
                self._dispatch(self.machine.reconnect(self.now()))
            elif kind == "rename":
                self.model.display_name = str(command[1])
                self._emit()

    def _request_directory(self, relative: str) -> None:
        self._files_open = True
        path = directory_rpc_path(relative)
        if path is None:
            self.model.files_message = "That folder is not available"
            self.publish_files(self.model.files_snapshot())
            return
        self.model.directory = "" if relative.strip() == "" else relative
        if self.machine.phase != "open":
            self.model.files_message = "Not connected to Moonraker"
            self.publish_files(self.model.files_snapshot())
            return
        self._dispatch(
            self.machine.request(
                "server.files.get_directory",
                {"path": path, "extended": True},
                f"dir:{relative}",
                self.now(),
            )
        )

    def _maybe_metadata(self) -> None:
        filename = self.model.metadata_wanted()
        if not filename or filename == self._metadata_inflight:
            return
        self._metadata_inflight = filename
        self.model.note_metadata_request(filename)
        self.publish_thumbnail(None)
        self._dispatch(
            self.machine.request("server.files.metadata", {"filename": filename}, f"meta:{filename}", self.now())
        )

    def _dispatch(self, effects: list[Effect]) -> None:
        for effect in effects:
            if effect.kind == "event":
                self._on_event(effect.data)
            elif effect.kind == "connect":
                asyncio.get_running_loop().create_task(self._connect(effect))
            elif effect.kind == "send" and self._socket is not None:
                asyncio.get_running_loop().create_task(self._send(effect))
            elif effect.kind == "close":
                asyncio.get_running_loop().create_task(self._close_current(effect))

    async def _connect(self, effect: Effect) -> None:
        generation = int(effect.data["generation"])
        url = str(effect.data["url"])
        try:
            socket = await self.connect(url)
        except Exception as exc:
            self.log(f"connect failed {redact_url(url)}: {exc}")
            self._dispatch(self.machine.on_close(generation, str(exc) or "Connection failed", self.now()))
            return
        if generation != self.machine.generation:
            await socket.close()
            return
        self._socket = socket
        self._socket_generation = generation
        self.log(f"connected {redact_url(url)}")
        self._wake.set()
        self._dispatch(self.machine.on_open(generation, self.now()))

    async def _send(self, effect: Effect) -> None:
        socket = self._socket
        if socket is None or int(effect.data.get("generation", -1)) != self._socket_generation:
            return
        try:
            await socket.send(str(effect.data["text"]))
        except Exception as exc:
            await self._closed_socket(str(exc) or "Send failed")

    async def _close_current(self, effect: Effect) -> None:
        generation = int(effect.data.get("generation", -1))
        reason = str(effect.data.get("reason") or "Connection closed")
        socket = self._socket
        if socket is not None and self._socket_generation == generation:
            self._socket = None
            try:
                await socket.close()
            except Exception:
                pass
        self._wake.set()
        self._dispatch(self.machine.on_close(generation, reason, self.now()))

    async def _closed_socket(self, reason: str) -> None:
        generation = self._socket_generation
        if generation != self.machine.generation:
            return
        self._socket = None
        self._dispatch(self.machine.on_close(generation, reason, self.now()))

    def _on_event(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind == "transport" and event.get("state") == "connected":
            self.log("identified with Moonraker")
        if kind == "rpc" and str(event.get("token", "")).startswith("meta:"):
            filename = str(event["token"])[5:]
            if self._metadata_inflight == filename:
                self._metadata_inflight = None
            if filename != self.model._job_filename():
                return
            self.model.apply({"type": "metadata", "filename": filename, "metadata": event.get("result")})
            self._emit()
            path = self.model.thumbnail_path
            if path:
                asyncio.get_running_loop().create_task(self._load_thumbnail(filename, path))
            else:
                self.publish_thumbnail(None)
            return
        if kind == "rpc" and str(event.get("token", "")).startswith("dir:"):
            relative = str(event["token"])[4:]
            result = event.get("result") if isinstance(event.get("result"), dict) else {}
            self.model.listing = map_directory(relative, result)
            self.model.directory = relative
            self.model.files_message = ""
            self.publish_files(self.model.files_snapshot())
            return
        if kind == "rpc_error" and str(event.get("token", "")).startswith("meta:"):
            filename = str(event["token"])[5:]
            self._metadata_inflight = None
            self.model.apply({"type": "metadata", "filename": filename, "metadata": None})
            self.publish_thumbnail(None)
            self._emit()
            return
        if kind == "rpc_error" and str(event.get("token", "")).startswith("dir:"):
            self.model.files_message = str(event.get("message") or "Could not load files")
            self.publish_files(self.model.files_snapshot())
            return
        if kind == "rejected":
            self.log(f"refused method {event.get('method')}")
            return
        self.model.apply(event)
        if kind == "filelist" and self._files_open:
            self._request_directory(self.model.directory)
        self._emit()
        if kind in {"snapshot", "status"}:
            self._maybe_metadata()

    async def _load_thumbnail(self, filename: str, path: str) -> None:
        url = thumbnail_url(self.machine.base_url, path)
        if url is None:
            self.publish_thumbnail(None)
            return
        try:
            data = await asyncio.to_thread(fetch_bytes, url, self.api_key)
        except Exception as exc:
            self.log(f"thumbnail skipped: {exc}")
            data = None
        if self.model.thumbnail_path != path or self.model._job_filename() != filename:
            return
        self.publish_thumbnail(data)

    def _emit(self) -> None:
        self.publish(self.model.snapshot())

    def _timeout(self) -> float | None:
        now = self.now()
        deadlines: list[float] = []
        if self.machine.retry_at is not None and self.machine.phase == "waiting":
            deadlines.append(self.machine.retry_at)
        if self.machine.poll_at is not None:
            deadlines.append(self.machine.poll_at)
        for item in self.machine.pending.values():
            deadlines.append(item["deadline"])
        if not deadlines:
            return 0.5
        return max(0.0, min(deadlines) - now)


def http_base(base_url: str) -> str:
    return to_http_url(base_url, "/")


def oneshot_token_request(base_url: str, api_key: str) -> tuple[str, dict[str, str]]:
    return to_http_url(base_url, "/access/oneshot_token"), {"X-Api-Key": api_key, "User-Agent": "LAYR-Qt"}


def parse_oneshot(body: str) -> str:
    payload = json.loads(body)
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, str) or not result:
        raise ValueError("Unexpected oneshot token response")
    return result
