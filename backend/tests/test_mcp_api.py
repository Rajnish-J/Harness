"""POST /api/mcp/{id}/test: connect to one server right now.

Called directly rather than through a TestClient, the same way
test_config_endpoint.py does -- the route is a plain function of its
dependencies, and nothing about the HTTP layer is under test here.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.mcp import test_mcp_server as call_test_mcp_server
from app.core.config import get_settings
from app.db.registry_repo import McpServerRow
from app.mcp.credentials import ResolvedAuth, no_auth


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


@dataclass
class FakeManager:
    """Only what the route calls: test_connection(server, auth)."""

    ok: bool
    error: str | None = None
    tool_count: int = 0
    seen: list[tuple[McpServerRow, ResolvedAuth]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.seen = []

    async def test_connection(self, server, auth):
        self.seen.append((server, auth))
        return self.ok, self.error, self.tool_count


def request_with(*, manager=None, pool=object()) -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(mcp=manager, pool=pool)))


def settings_with(**overrides):
    return get_settings().model_copy(update={"mock_mcp": False, **overrides})


async def test_no_manager_is_a_503():
    request = request_with(manager=None)
    with pytest.raises(HTTPException) as excinfo:
        await call_test_mcp_server("some-id", request, settings_with())
    assert excinfo.value.status_code == 503


async def test_no_database_is_a_503_outside_mock_mode():
    request = request_with(manager=FakeManager(ok=True), pool=None)
    with pytest.raises(HTTPException) as excinfo:
        await call_test_mcp_server("some-id", request, settings_with())
    assert excinfo.value.status_code == 503


async def test_no_database_under_mock_mcp_is_a_verdict_not_an_error():
    request = request_with(manager=FakeManager(ok=True), pool=None)
    result = await call_test_mcp_server(
        "some-id", request, settings_with(mock_mcp=True)
    )
    assert result.ok is True


async def test_an_unknown_server_is_a_404(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "app.api.mcp.get_enabled_mcp_servers", lambda pool, ids: _no_rows()
    )
    request = request_with(manager=FakeManager(ok=True))
    with pytest.raises(HTTPException) as excinfo:
        await call_test_mcp_server("missing-id", request, settings_with())
    assert excinfo.value.status_code == 404


async def _no_rows():
    return []


async def test_a_successful_connect_reports_ok_and_tool_count(
    monkeypatch: pytest.MonkeyPatch,
):
    row = server_row()

    async def fake_servers(pool, ids):
        assert ids == [str(row.id)]
        return [row]

    async def fake_resolve_auth(pool, settings, server):
        return no_auth()

    monkeypatch.setattr("app.api.mcp.get_enabled_mcp_servers", fake_servers)
    monkeypatch.setattr("app.api.mcp.resolve_auth", fake_resolve_auth)

    manager = FakeManager(ok=True, tool_count=7)
    request = request_with(manager=manager)

    result = await call_test_mcp_server(str(row.id), request, settings_with())

    assert result.ok is True
    assert result.error is None
    assert result.tool_count == 7
    assert manager.seen[0][0].id == row.id


async def test_a_failed_connect_is_a_200_verdict_not_an_http_error(
    monkeypatch: pytest.MonkeyPatch,
):
    """Mirrors POST /api/credentials/{id}/test: a rejected token is data."""
    row = server_row()

    async def fake_servers(pool, ids):
        return [row]

    async def fake_resolve_auth(pool, settings, server):
        return no_auth()

    monkeypatch.setattr("app.api.mcp.get_enabled_mcp_servers", fake_servers)
    monkeypatch.setattr("app.api.mcp.resolve_auth", fake_resolve_auth)

    manager = FakeManager(ok=False, error="github: HTTP 401 (check the token)")
    request = request_with(manager=manager)

    result = await call_test_mcp_server(str(row.id), request, settings_with())

    assert result.ok is False
    assert "401" in result.error


async def test_a_credential_notice_surfaces_even_when_the_connect_itself_ok(
    monkeypatch: pytest.MonkeyPatch,
):
    """A missing/disabled credential is worth surfacing even if, say, mock
    mode or a no-auth server still reports a successful connect."""
    row = server_row()

    async def fake_servers(pool, ids):
        return [row]

    async def fake_resolve_auth(pool, settings, server):
        return ResolvedAuth(headers={}, fingerprint="missing", notice="credential missing")

    monkeypatch.setattr("app.api.mcp.get_enabled_mcp_servers", fake_servers)
    monkeypatch.setattr("app.api.mcp.resolve_auth", fake_resolve_auth)

    manager = FakeManager(ok=True, tool_count=0)
    request = request_with(manager=manager)

    result = await call_test_mcp_server(str(row.id), request, settings_with())

    assert result.error == "credential missing"


# --------------------------------------------------------- notice shapes
#
# The route serves both shapes: `notices` stayed a flat string list so existing
# consumers keep working, and `server_notices` carries the id the UI needs to
# put a failure against the right row.


async def test_tools_route_serves_both_notice_shapes(monkeypatch: pytest.MonkeyPatch):
    from app.api.mcp import list_mcp_tools
    from app.mcp.manager import McpNotice

    async def fake_resolve(_app, _settings, _ids):
        return [], [
            McpNotice(message="boom", server_id="abc", server_name="github"),
            McpNotice(message="no database"),
        ]

    monkeypatch.setattr("app.api.mcp.resolve_mcp_tools", fake_resolve)

    payload = await list_mcp_tools(
        request_with(manager=FakeManager(ok=True)), "abc", settings_with()
    )

    # Unchanged wire contract.
    assert payload["notices"] == ["boom", "no database"]
    # And the structured half, including the notice that names no server.
    assert payload["server_notices"][0]["server_id"] == "abc"
    assert payload["server_notices"][1]["server_id"] is None
