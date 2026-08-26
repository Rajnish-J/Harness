"""Connection management for MCP servers.

## Why this looks the way it does

`async with Client(...)` is backed by an anyio task group. Entering it in one
task and exiting it in another raises `RuntimeError: Attempted to exit cancel
scope in a different task`. So the obvious implementation — open a client, stash
it on app.state, reuse it from whichever request arrives next — breaks the first
time a connection is reused or torn down.

The fix is the shape of this module: one dedicated asyncio.Task owns a
connection for its entire lifetime, opening and closing it inside a single
coroutine. Callers never touch the client. They put a job on a queue and await a
future that the owning task resolves.

## Lifecycle

Connections are opened lazily per server and cached for the life of the app,
keyed by (id, updated_at). Spawning `npx` on every chat message would cost
seconds; connecting every enabled server at startup would spawn subprocesses
nobody asked for. Including updated_at in the key means editing a server in the
UI misses the cache and reconnects with the new settings, so there is no stale
config to debug.

Every failure is contained: a server that will not start, will not list, or
times out mid-call degrades that turn to the built-in tools. It never fails the
chat.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from mcp import Client

from app.core.config import Settings
from app.db.registry_repo import McpServerRow
from app.mcp.config import McpConfigError, connection_target
from app.mcp.tools import dedupe, make_tool

logger = logging.getLogger(__name__)

_SHUTDOWN = object()


@dataclass
class _Job:
    name: str
    args: dict[str, Any]
    future: asyncio.Future[Any]


@dataclass
class _Runner:
    """Owns one MCP connection, start to finish, inside one task."""

    server: McpServerRow
    settings: Settings

    queue: asyncio.Queue[Any] = field(default_factory=asyncio.Queue)
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    tools: list[Any] = field(default_factory=list)
    error: str | None = None
    task: asyncio.Task[None] | None = None
    last_used: float = field(default_factory=time.monotonic)

    async def start(self) -> None:
        self.task = asyncio.create_task(
            self._run(), name=f"mcp:{self.server.name}"
        )
        # Bounded: a server that never initializes must not hang the request.
        budget = self.settings.mcp_connect_timeout + self.settings.mcp_list_timeout
        try:
            await asyncio.wait_for(self.ready.wait(), budget + 1)
        except asyncio.TimeoutError:
            self.error = (
                f"{self.server.name}: did not become ready within {budget:.0f}s"
            )
            await self.aclose()

    async def _run(self) -> None:
        try:
            target = connection_target(self.server)
        except McpConfigError as exc:
            self.error = str(exc)
            self.ready.set()
            return

        try:
            # Entering the client performs the initialize handshake. It is not
            # wrapped in wait_for here because cancelling an async context
            # manager mid-enter is exactly the anyio hazard this design avoids;
            # start() bounds the whole connect from the caller's side instead.
            async with Client(target) as client:
                listed = await asyncio.wait_for(
                    client.list_tools(), self.settings.mcp_list_timeout
                )
                self.tools = list(listed.tools)
                self.ready.set()

                while True:
                    job = await self.queue.get()
                    if job is _SHUTDOWN:
                        return
                    try:
                        result = await asyncio.wait_for(
                            client.call_tool(job.name, job.args),
                            self.settings.mcp_tool_timeout,
                        )
                        if not job.future.done():
                            job.future.set_result(result)
                    except asyncio.TimeoutError:
                        if not job.future.done():
                            job.future.set_exception(
                                TimeoutError(
                                    f"{job.name} timed out after "
                                    f"{self.settings.mcp_tool_timeout:.0f}s"
                                )
                            )
                    except Exception as exc:  # noqa: BLE001 - reported to the model
                        if not job.future.done():
                            job.future.set_exception(exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad server, not a dead chat
            logger.warning("MCP server %s failed: %s", self.server.name, exc)
            self.error = f"{self.server.name}: {exc}"
        finally:
            self.ready.set()
            self._drain()

    def _drain(self) -> None:
        """Fail anything still queued, so no caller waits on a dead runner."""
        while not self.queue.empty():
            job = self.queue.get_nowait()
            if job is not _SHUTDOWN and not job.future.done():
                job.future.set_exception(
                    ConnectionError(f"{self.server.name} disconnected")
                )

    @property
    def alive(self) -> bool:
        return self.error is None and self.task is not None and not self.task.done()

    async def call(self, name: str, args: dict[str, Any]) -> Any:
        if not self.alive:
            raise ConnectionError(
                self.error or f"{self.server.name} is not connected"
            )
        self.last_used = time.monotonic()
        job = _Job(name=name, args=args, future=asyncio.get_running_loop().create_future())
        await self.queue.put(job)
        return await job.future

    async def aclose(self) -> None:
        task = self.task
        if task is None or task.done():
            return
        await self.queue.put(_SHUTDOWN)
        try:
            # Bounded: a server ignoring its stdin close must not hang shutdown.
            await asyncio.wait_for(task, 5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            task.cancel()
        except Exception:  # noqa: BLE001
            task.cancel()


class McpManager:
    """One runner per (server id, config fingerprint). Lives on app.state.mcp."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._runners: dict[tuple[str, str], _Runner] = {}
        # A server that failed recently is not respawned on every message.
        self._failures: dict[str, tuple[float, str]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _key(server: McpServerRow) -> tuple[str, str]:
        return (str(server.id), server.updated_at.isoformat())

    async def tools_for(
        self, servers: list[McpServerRow]
    ) -> tuple[list[Any], list[str]]:
        """Discovered tools plus human-readable notices for anything that failed."""
        if self._settings.mock_mcp:
            from app.mcp.mock import mock_tools_for

            return mock_tools_for(servers), []

        tools: list[Any] = []
        notices: list[str] = []

        for server in servers:
            try:
                runner = await self._runner_for(server)
            except Exception as exc:  # noqa: BLE001
                notices.append(f"MCP server {server.name!r} unavailable: {exc}")
                continue

            if runner is None or not runner.alive:
                reason = (runner.error if runner else None) or "could not connect"
                notices.append(f"MCP server {server.name!r} unavailable: {reason}")
                continue

            tools.extend(
                make_tool(server.name, runner, mcp_tool) for mcp_tool in runner.tools
            )

        return dedupe(tools), notices

    async def _runner_for(self, server: McpServerRow) -> _Runner | None:
        key = self._key(server)

        async with self._lock:
            existing = self._runners.get(key)
            if existing and existing.alive:
                existing.last_used = time.monotonic()
                return existing

            # Drop any runner for an older revision of this same server.
            for stale_key in [k for k in self._runners if k[0] == key[0] and k != key]:
                stale = self._runners.pop(stale_key)
                await stale.aclose()

            failed_at, reason = self._failures.get(key[0], (0.0, ""))
            if time.monotonic() - failed_at < self._settings.mcp_retry_cooldown:
                raise ConnectionError(reason)

            runner = _Runner(server=server, settings=self._settings)
            await runner.start()

            if not runner.alive:
                self._failures[key[0]] = (
                    time.monotonic(),
                    runner.error or "could not connect",
                )
                self._runners.pop(key, None)
                return runner

            self._failures.pop(key[0], None)
            self._runners[key] = runner
            return runner

    async def sweep_idle(self) -> None:
        """Close connections nobody has used lately, so no subprocess lingers."""
        cutoff = time.monotonic() - self._settings.mcp_idle_timeout
        async with self._lock:
            for key in [k for k, r in self._runners.items() if r.last_used < cutoff]:
                runner = self._runners.pop(key)
                logger.info("Closing idle MCP server %s", runner.server.name)
                await runner.aclose()

    async def aclose(self) -> None:
        async with self._lock:
            runners = list(self._runners.values())
            self._runners.clear()
        for runner in runners:
            await runner.aclose()
