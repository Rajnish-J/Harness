"""Failure reporting for MCP connections: unwrapping ExceptionGroup, and the
HTTP detail an httpx response hook can still see once it is gone.

None of these start a real subprocess or hit the network — the point is that a
connect failure surfaces a legible reason instead of "unhandled errors in a
TaskGroup (1 sub-exception)".
"""

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest

from app.core.config import Settings, get_settings
from app.db.registry_repo import McpServerRow
from app.mcp.config import HttpFailure
from app.mcp.manager import McpManager, _Runner, describe_exception


class BoomError(Exception):
    """Stands in for mcp.shared.exceptions.MCPError -- any leaf exception."""


def server_row(**overrides: Any) -> McpServerRow:
    base = dict(
        id=uuid4(),
        name="github",
        transport="http",
        command=None,
        args=[],
        url="https://example.com/mcp/",
        env={},
        headers={},
        credential_id=None,
        enabled=True,
        updated_at=datetime.now(UTC),
    )
    base.update(overrides)
    return McpServerRow(**base)


def settings() -> Settings:
    return get_settings().model_copy(update={"mock_mcp": False})


# ----------------------------------------------------- describe_exception


def test_unwraps_a_doubly_nested_exceptiongroup():
    """This is the exact shape mcp 2.1.1 raises on a failed connect."""
    leaf = BoomError("Server returned an error response")
    group = ExceptionGroup(
        "unhandled errors in a TaskGroup",
        [ExceptionGroup("unhandled errors in a TaskGroup", [leaf])],
    )

    message = describe_exception(group)

    assert message == "BoomError: Server returned an error response"
    assert "TaskGroup" not in message


def test_multiple_leaves_are_joined_and_deduplicated():
    group = ExceptionGroup(
        "unhandled errors in a TaskGroup",
        [BoomError("a"), BoomError("a"), ValueError("b")],
    )

    message = describe_exception(group)

    assert message == "BoomError: a; ValueError: b"


def test_a_plain_exception_is_not_touched():
    assert describe_exception(ValueError("plain")) == "ValueError: plain"


def test_an_empty_group_falls_back_to_the_group_itself():
    # ExceptionGroup requires at least one sub-exception to construct, so the
    # degenerate empty-group case is simulated with a bare object carrying an
    # empty `exceptions` sequence rather than a real (uninstantiable) one.
    class FakeEmptyGroup(Exception):
        exceptions: tuple[Exception, ...] = ()
        __cause__ = None

    message = describe_exception(FakeEmptyGroup("unhandled errors in a TaskGroup"))

    assert "unhandled errors in a TaskGroup" in message


def test_a_leaf_with_no_message_falls_back_to_its_cause():
    leaf = BoomError()
    try:
        raise leaf from ValueError("the real reason")
    except BoomError as caught:
        message = describe_exception(caught)

    assert message == "ValueError: the real reason"


def test_a_leaf_with_no_message_and_no_cause_still_names_its_type():
    assert describe_exception(BoomError()) == "BoomError"


# ------------------------------------------------- runner failure -> notice


async def test_a_nested_group_from_connect_becomes_a_legible_notice(monkeypatch):
    """End to end: _Runner.start() catches the group; tools_for reports it."""

    def explode(*_args, **_kwargs):
        raise ExceptionGroup(
            "unhandled errors in a TaskGroup",
            [
                ExceptionGroup(
                    "unhandled errors in a TaskGroup",
                    [BoomError("Server returned an error response")],
                )
            ],
        )

    monkeypatch.setattr("app.mcp.manager.connection_target", explode)

    class FakeClient:
        def __init__(self, _target):
            raise AssertionError("connection_target must raise before Client is built")

    monkeypatch.setattr("app.mcp.manager.Client", FakeClient)

    manager = McpManager(settings())
    tools, notices = await manager.tools_for([server_row()])

    assert tools == []
    assert len(notices) == 1
    assert "github" in notices[0].message
    assert "unavailable" in notices[0].message
    assert "Server returned an error response" in notices[0].message
    assert "TaskGroup" not in notices[0].message


async def test_an_http_failure_appends_status_and_hint(monkeypatch):
    """The event hook in app.mcp.config captures what the ExceptionGroup buries."""

    def explode(*_args, failure=None, **_kwargs):
        if failure is not None:
            failure.status_code = 401
            failure.body = "bad request: missing required Authorization header"
        raise ExceptionGroup(
            "unhandled errors in a TaskGroup",
            [BoomError("Server returned an error response")],
        )

    monkeypatch.setattr("app.mcp.manager.connection_target", explode)

    manager = McpManager(settings())
    _tools, notices = await manager.tools_for([server_row()])

    assert len(notices) == 1
    assert "401" in notices[0].message
    assert "Credentials page" in notices[0].message
    # The bearer token must never appear in a notice.
    assert "Bearer" not in notices[0].message


async def test_a_notice_carries_the_server_it_is_about(monkeypatch):
    """The UI attaches a failure to a row by id, not by matching the prose.

    Matching on the name inside the message cross-matched servers whose names
    were substrings of one another, and could not place the notices that name
    no server at all.
    """

    def explode(*_args, **_kwargs):
        raise BoomError("nope")

    monkeypatch.setattr("app.mcp.manager.connection_target", explode)

    server = server_row(name="github")
    manager = McpManager(settings())
    _tools, notices = await manager.tools_for([server])

    assert len(notices) == 1
    assert notices[0].server_id == str(server.id)
    assert notices[0].server_name == "github"


# ----------------------------------------------------------- idle sweeping
#
# sweep_idle was written and never called: MCP_IDLE_TIMEOUT was a setting with
# no effect, and a stdio server's child process lived as long as the process
# did. app/main.py now runs it on a task; these pin the sweep itself.


class _FakeRunner:
    def __init__(self, last_used: float) -> None:
        self.last_used = last_used
        self.server = server_row(name="fake")
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


async def test_sweep_closes_a_runner_nobody_has_used():
    manager = McpManager(get_settings().model_copy(update={"mcp_idle_timeout": 1.0}))
    stale = _FakeRunner(last_used=time.monotonic() - 3600)
    manager._runners[("id", "rev")] = stale

    await manager.sweep_idle()

    assert stale.closed is True
    assert manager._runners == {}


async def test_sweep_keeps_a_runner_still_in_use():
    manager = McpManager(get_settings().model_copy(update={"mcp_idle_timeout": 300.0}))
    fresh = _FakeRunner(last_used=time.monotonic())
    manager._runners[("id", "rev")] = fresh

    await manager.sweep_idle()

    assert fresh.closed is False
    assert ("id", "rev") in manager._runners
