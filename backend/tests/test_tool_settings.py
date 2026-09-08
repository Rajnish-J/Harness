"""The global tool disable list, subtracted from every turn.

Drives the real `_prepare_turn`, the same way test_mcp_in_turn.py does -- one
layer below the model call, which is as far as this environment reaches. What
that proves here is complete, though: the toolset a turn carries IS the toolset
the request advertises and the loop will dispatch from.

The load-bearing case is
test_requesting_only_disabled_tools_yields_nothing_not_everything. Subtracting
the disable list from payload.tool_names *before* merge_toolsets would leave an
empty name list, which that function reads as falsy and expands to the entire
registry -- so a switch flipped off on /tools would silently grant shell and
file-write access instead of removing one tool. The filter must run after.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.agent.tools.registry import ALL_TOOLS
from app.api import chat as chat_api
from app.core.config import Settings
from app.mcp.manager import McpManager
from app.models.chat import ChatRequest


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(anthropic_api_key="test-key", workspace_root=tmp_path, mock_mcp=True)


def request_with(settings: Settings, *, pool: object | None = object()) -> SimpleNamespace:
    """A request whose app carries a pool sentinel and a manager.

    The pool is never dialled: every test stubs the repo read that would use it.
    Passing pool=None exercises the no-database path instead.
    """
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(pool=pool, mcp=McpManager(settings)))
    )


@pytest.fixture
def disable(monkeypatch: pytest.MonkeyPatch):
    """Stub the repo read with a fixed set, and skip memory's own read."""

    async def _no_memories(_pool, _project_id):
        return []

    monkeypatch.setattr("app.db.memory_repo.list_active", _no_memories)

    def _set(names: set[str]):
        async def _read(_pool):
            return names

        monkeypatch.setattr(
            "app.db.registry_repo.list_disabled_tool_names", _read
        )

    return _set


#: Appended by _prepare_turn itself in the global chat, and never part of
#: ALL_TOOLS -- so they are not what these tests are measuring. Named here once
#: rather than subtracted ad hoc at each call site.
PROJECT_TOOLS = ["propose_create_project", "list_projects", "propose_attach_project"]


def names_of(turn) -> list[str]:
    return [tool.name for tool in turn.tools]


def registry_names_of(turn) -> list[str]:
    """The turn's tools minus the global chat's own proposal tools."""
    return [name for name in names_of(turn) if name not in PROJECT_TOOLS]


async def prepare(request, settings, **payload):
    turn, _ = await chat_api._prepare_turn(
        request, ChatRequest(session_id="s", message="hi", **payload), settings
    )
    return turn


# ------------------------------------------------------------ the subtraction


async def test_a_disabled_tool_never_reaches_the_turn(settings, disable):
    disable({"write_file"})

    turn = await prepare(request_with(settings), settings)

    assert "write_file" not in names_of(turn)
    # And the rest of the registry is untouched -- this narrows, it does not
    # collapse the toolset.
    assert "read_file" in names_of(turn)


async def test_a_disabled_tool_is_removed_even_when_explicitly_requested(
    settings, disable
):
    """The global list outranks a per-turn allowlist that names the tool."""
    disable({"write_file"})

    turn = await prepare(
        request_with(settings), settings, tool_names=["read_file", "write_file"]
    )

    assert registry_names_of(turn) == ["read_file"]


async def test_requesting_only_disabled_tools_yields_nothing_not_everything(
    settings, disable
):
    """The escalation this whole ordering exists to prevent.

    If the filter ran against payload.tool_names first, this turn would arrive
    at merge_toolsets with an empty list -- read as "no allowlist" -- and be
    handed every tool in the registry.
    """
    disable({"write_file"})

    turn = await prepare(request_with(settings), settings, tool_names=["write_file"])

    # Nothing from the registry survives. The three that remain are the global
    # chat's own proposal tools, appended after the filter by design.
    assert registry_names_of(turn) == []
    assert names_of(turn) == PROJECT_TOOLS


async def test_the_project_tools_survive_the_filter(settings, disable):
    """The list governs the registry, not this route's own injected tools.

    propose_create_project and friends are not in ALL_TOOLS, so they can never
    appear on /tools and can never be switched off there.
    """
    disable({tool.name for tool in ALL_TOOLS})

    # project_id is None (the global chat) and the mode is not "chat", which is
    # what makes _prepare_turn append the three proposal tools.
    turn = await prepare(request_with(settings), settings)

    assert names_of(turn) == PROJECT_TOOLS


async def test_registry_order_survives_the_filter(settings, disable):
    """Filtering must not reorder: ALL_TOOLS order keeps the prompt prefix cacheable."""
    disable({"list_directory", "git_log"})

    turn = await prepare(request_with(settings), settings)
    surviving = [
        name for name in registry_names_of(turn) if not name.startswith("mcp__")
    ]

    registry = [tool.name for tool in ALL_TOOLS]
    positions = [registry.index(name) for name in surviving if name in registry]
    assert positions == sorted(positions)


# ------------------------------------------------------------------ fail-open


async def test_no_database_is_not_fatal(settings, monkeypatch):
    """DATABASE_URL unset is a supported configuration, not a reason to have no tools."""

    async def _boom(_pool):
        raise AssertionError("must not be called without a pool")

    monkeypatch.setattr("app.db.registry_repo.list_disabled_tool_names", _boom)

    turn = await prepare(request_with(settings, pool=None), settings)

    assert "write_file" in names_of(turn)


async def test_a_read_failure_is_not_fatal(settings, monkeypatch):
    """Fail-open, deliberately -- and the turn says so rather than staying silent.

    A database outage restores tools someone switched off, which is a widening.
    That is the accepted trade: this list is a preference on an admin page, and
    failing closed would end every turn with no tools whenever Postgres blinked.
    Changing that posture has to change this test too.
    """

    async def _no_memories(_pool, _project_id):
        return []

    async def _raise(_pool):
        raise RuntimeError("connection refused")

    monkeypatch.setattr("app.db.memory_repo.list_active", _no_memories)
    monkeypatch.setattr("app.db.registry_repo.list_disabled_tool_names", _raise)

    turn, notices = await chat_api._prepare_turn(
        request_with(settings),
        ChatRequest(session_id="s", message="hi"),
        settings,
    )

    assert "write_file" in names_of(turn)
    assert any(code == "tool_settings_unavailable" for _message, code in notices)


async def test_chat_mode_is_unaffected(settings, disable):
    """Chat mode already advertises nothing; the filter must not change that."""
    disable({"read_file"})

    turn = await prepare(request_with(settings), settings, mode="chat")

    assert turn.tools == []
