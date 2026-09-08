"""An attached MCP server must be named in the turn's system prompt.

The bug this pins, end to end: with the `github` server attached and its tools
in the request, the model was told nothing about them, so it answered "what
repos do I have" by asking for a username and an access token instead of
calling one of the thirty already-authenticated tools it had been handed.

This drives the real `_prepare_turn` under MOCK_MCP, which is one layer below
the model call -- the furthest this environment can verify, since no live LLM
is reachable here. What it proves is that the instruction and the tools land in
the same request; whether a given model then behaves is observable only by
running it.
"""

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api import chat as chat_api
from app.core.config import Settings
from app.mcp.manager import McpManager
from app.models.chat import ChatRequest


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(anthropic_api_key="test-key", workspace_root=tmp_path, mock_mcp=True)


@pytest.fixture
def request_with_mcp(settings: Settings) -> SimpleNamespace:
    # No pool: under MOCK_MCP resolve_mcp_tools fabricates the rows, so the
    # whole path runs with no database. Memory loading is skipped for the same
    # reason, which keeps this test about MCP only.
    return SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(pool=None, mcp=McpManager(settings))
        )
    )


async def test_an_attached_server_is_named_and_declared_authenticated(
    settings, request_with_mcp
):
    server_id = str(uuid4())

    turn, _ = await chat_api._prepare_turn(
        request_with_mcp,
        ChatRequest(
            session_id="s",
            message="what repos do I have?",
            mcp_server_ids=[server_id],
        ),
        settings,
    )

    # The mock names a server after its own id, which is what reaches the prompt.
    expected = f"mock-{server_id[:8]}"
    assert expected in turn.system
    assert "already authenticated" in turn.system
    assert "never ask the user for a username" in turn.system.lower()

    # And the tools it describes are genuinely in the same request.
    assert any(tool.name.startswith("mcp__") for tool in turn.tools)


async def test_no_attached_server_leaves_the_prompt_alone(settings, request_with_mcp):
    """A turn with nothing attached must not carry the block at all."""
    turn, _ = await chat_api._prepare_turn(
        request_with_mcp,
        ChatRequest(session_id="s", message="hi"),
        settings,
    )

    assert "already authenticated" not in turn.system
    assert not any(tool.name.startswith("mcp__") for tool in turn.tools)


async def test_chat_mode_advertises_no_servers(settings, request_with_mcp):
    """Chat mode resolves no MCP, so it must promise none either."""
    turn, _ = await chat_api._prepare_turn(
        request_with_mcp,
        ChatRequest(
            session_id="s",
            message="hi",
            mode="chat",
            mcp_server_ids=[str(uuid4())],
        ),
        settings,
    )

    assert "already authenticated" not in turn.system
    assert turn.tools == []
