"""The chat preset: wire contract, per-turn overrides, and toolset narrowing.

These avoid a live model on purpose. What matters is that a preset produces the
right settings and the right toolset — the loop's behaviour given a toolset is
already pinned by test_tool_subset.py.
"""

import pytest

from app.agent.tools.registry import ALL_TOOLS
from app.agent.tools.toolsets import merge_toolsets
from app.core.config import get_settings
from app.models.chat import ChatRequest


def test_bare_body_still_parses_and_changes_nothing():
    """The pre-preset request shape must remain valid and inert."""
    req = ChatRequest(session_id="s", message="hi")

    assert req.agent_id is None
    assert req.system_prompt is None
    assert req.skills == []
    # None, not [] — the loop treats None as "the full registry".
    assert req.tool_names is None
    assert req.mcp_server_ids == []
    assert req.model is None
    assert req.max_iterations is None


def test_model_override_is_pattern_checked():
    ChatRequest(session_id="s", message="m", model="claude-haiku-4-5")

    with pytest.raises(ValueError):
        ChatRequest(session_id="s", message="m", model="oops; rm -rf /")


def test_max_iterations_is_bounded():
    with pytest.raises(ValueError):
        ChatRequest(session_id="s", message="m", max_iterations=0)
    with pytest.raises(ValueError):
        ChatRequest(session_id="s", message="m", max_iterations=999)


def test_settings_copy_applies_the_iteration_override():
    """model_copy is the seam chat.py uses; confirm it does not mutate the cache."""
    settings = get_settings()
    original = settings.max_agent_iterations

    turn = settings.model_copy(update={"max_agent_iterations": 3})

    assert turn.max_agent_iterations == 3
    assert get_settings().max_agent_iterations == original


def test_settings_copy_applies_the_model_override():
    settings = get_settings()
    original = settings.anthropic_model

    turn = settings.model_copy(update={"anthropic_model": "claude-haiku-4-5"})

    assert turn.anthropic_model == "claude-haiku-4-5"
    assert get_settings().anthropic_model == original


def test_preset_toolset_excludes_write_file():
    """A read-only preset must not even advertise write_file.

    Dispatch-level refusal is covered by test_tool_subset; this pins the
    resolution step chat.py performs before the loop ever sees the list.
    """
    req = ChatRequest(
        session_id="s",
        message="write a file",
        tool_names=["read_file", "list_directory"],
    )
    tools = merge_toolsets(req.tool_names, [])
    names = {tool.name for tool in tools}

    assert names == {"read_file", "list_directory"}
    assert "write_file" not in names


def test_no_allowlist_means_the_full_registry():
    req = ChatRequest(session_id="s", message="hi")
    assert merge_toolsets(req.tool_names, []) == ALL_TOOLS


def test_skill_payload_bounds_content():
    from app.models.chat import SkillPayload

    SkillPayload(name="ok", content="x" * 50_000)
    with pytest.raises(ValueError):
        SkillPayload(name="too big", content="x" * 50_001)
