"""The pre-flight tool router: what a turn is shown, and what it is spared.

The router's whole job is to make the advertised toolset smaller than the pool,
so the tests that matter are the ones pinning what it must NOT do:

- it must never widen (a hallucinated name is not a grant),
- it must never reorder (tool order is the cacheable prompt prefix),
- it must never fail closed (a router outage is a cost problem, not a safety
  one, and a turn with zero tools is worse than an expensive turn).

Nothing here touches the network: the router's client is injected, which is also
how "it did not call the model at all" is asserted rather than assumed.
"""

import asyncio

import pytest

from app.agent.llm.base import LLMTurn
from app.agent.tools.base import Tool
from app.agent.tools.meta.request_tools import REQUEST_TOOLS_TOOL_NAME
from app.agent.tools.router import (
    CORE_TOOL_NAMES,
    ToolSelection,
    catalog_lines,
    first_sentence,
    parse_selection,
    restore_selection,
    select_tools,
)
from app.core.config import Settings


def tool(name: str, group: str = "Files", description: str = "") -> Tool:
    return Tool(
        name=name,
        description=description or f"Does {name}. Second sentence, much longer, ignore.",
        input_schema={"type": "object", "properties": {}},
        run=lambda **_: "",
        group=group,
    )


#: Deliberately larger than the default threshold so routing engages, and with
#: the three core names in the middle rather than at the front -- a result that
#: happened to be in pool order by luck would prove nothing.
POOL = [
    tool("alpha"),
    tool("read_file"),
    tool("git_commit", "Version Control"),
    tool("list_directory"),
    tool("run_tests", "Execution"),
    tool("search_files", "Validation"),
    tool("mcp__github__create_pr", "MCP: github"),
    tool("zeta"),
]


class FakeClient:
    """An LLMClient stand-in that records whether it was consulted."""

    provider = "fake"

    def __init__(self, reply: str | None = None, *, raises: Exception | None = None,
                 delay: float = 0.0) -> None:
        self.reply = reply
        self.raises = raises
        self.delay = delay
        self.calls: list[tuple[list, list, str]] = []

    def user_message(self, text: str) -> dict:
        return {"role": "user", "content": text}

    def tool_schemas(self, tools: list[Tool]) -> list[dict]:
        return [{"name": t.name} for t in tools]

    async def send(self, history, tools, system) -> LLMTurn:
        self.calls.append((history, tools, system))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.raises is not None:
            raise self.raises
        return LLMTurn(text=self.reply, tool_calls=[], stop_reason="end_turn")


@pytest.fixture
def settings(tmp_path) -> Settings:
    # Threshold below len(POOL) so the default path routes.
    return Settings(
        workspace_root=tmp_path,
        tool_router_threshold=4,
        tool_router_max_tools=12,
    )


async def route(pool, client, settings, **kwargs) -> ToolSelection:
    return await select_tools(
        pool=pool,
        user_message=kwargs.pop("message", "commit my work"),
        client=client,
        settings=settings,
        **kwargs,
    )


# ---------------------------------------------------------------- narrowing


async def test_narrows_to_the_picked_tools_plus_the_core_floor(settings):
    client = FakeClient('{"tools": ["git_commit"], "reason": "Committing."}')
    selection = await route(POOL, client, settings)

    assert selection.ran is True
    assert selection.reason == "Committing."
    names = selection.selected_names
    assert "git_commit" in names
    # The floor is present without having been asked for.
    for core in CORE_TOOL_NAMES:
        assert core in names
    # And the rest genuinely did not make it.
    assert "alpha" not in names
    assert "zeta" not in names


async def test_result_follows_pool_order_not_reply_order(settings):
    """Tool order is the cacheable prompt prefix, so it comes from the pool."""
    client = FakeClient(
        '{"tools": ["zeta", "mcp__github__create_pr", "alpha", "git_commit"]}'
    )
    selection = await route(POOL, client, settings)

    routed = [n for n in selection.selected_names if n != REQUEST_TOOLS_TOOL_NAME]
    pool_order = [t.name for t in POOL if t.name in set(routed)]
    assert routed == pool_order


async def test_a_name_that_is_not_in_the_pool_is_dropped_not_granted(settings):
    """The composer's allowlist and /tools are the ceiling. This cannot raise it."""
    client = FakeClient('{"tools": ["git_commit", "delete_everything"]}')
    selection = await route(POOL, client, settings)

    assert "delete_everything" not in selection.selected_names
    assert set(selection.selected_names) <= {t.name for t in POOL} | {
        REQUEST_TOOLS_TOOL_NAME
    }


async def test_held_back_tools_land_in_the_reserve_with_an_escape_hatch(settings):
    client = FakeClient('{"tools": ["git_commit"]}')
    selection = await route(POOL, client, settings)

    assert "zeta" in selection.reserve_names
    assert REQUEST_TOOLS_TOOL_NAME in selection.selected_names
    # Nothing is in both halves.
    assert not set(selection.selected_names) & set(selection.reserve_names)


async def test_nothing_held_back_means_no_escape_hatch(settings):
    """Advertising request_tools with an empty reserve is pure cost."""
    every = '{"tools": %s}' % str([t.name for t in POOL]).replace("'", '"')
    client = FakeClient(every)
    selection = await route(POOL, client, settings)

    assert selection.reserve == []
    assert REQUEST_TOOLS_TOOL_NAME not in selection.selected_names


async def test_the_cap_trims_picks_but_never_the_core_floor(settings, tmp_path):
    capped = Settings(
        workspace_root=tmp_path, tool_router_threshold=4, tool_router_max_tools=1
    )
    client = FakeClient('{"tools": ["alpha", "zeta", "git_commit"]}')
    selection = await route(POOL, client, capped)

    picks = [n for n in selection.selected_names
             if n not in CORE_TOOL_NAMES and n != REQUEST_TOOLS_TOOL_NAME]
    assert len(picks) == 1
    for core in CORE_TOOL_NAMES:
        assert core in selection.selected_names


# ------------------------------------------------------- when it does not run


async def test_a_pool_at_or_under_the_threshold_is_never_routed(settings):
    """Below the threshold the round trip costs more than it saves."""
    client = FakeClient('{"tools": ["read_file"]}')
    small = POOL[:4]
    selection = await select_tools(
        pool=small, user_message="hi", client=client, settings=settings
    )

    assert client.calls == []          # the point of the test
    assert selection.ran is False
    assert selection.tools == small
    assert selection.note is None      # not a failure, so nothing to explain


async def test_the_per_conversation_switch_forces_routing_on(settings):
    client = FakeClient('{"tools": ["git_commit"]}')
    selection = await select_tools(
        pool=POOL[:4], user_message="hi", client=client, settings=settings, enabled=True
    )
    assert len(client.calls) == 1
    assert selection.ran is True


async def test_the_per_conversation_switch_forces_routing_off(settings):
    client = FakeClient('{"tools": ["git_commit"]}')
    selection = await route(POOL, client, settings, enabled=False)

    assert client.calls == []
    assert selection.tools == POOL


async def test_disabled_server_side_skips_routing(tmp_path):
    off = Settings(workspace_root=tmp_path, tool_router_enabled=False)
    client = FakeClient('{"tools": ["git_commit"]}')
    selection = await route(POOL, client, off)

    assert client.calls == []
    assert selection.tools == POOL


async def test_an_empty_pool_is_left_alone(settings):
    """chat mode. There is no toolset to narrow, so there is no call to make."""
    client = FakeClient('{"tools": []}')
    selection = await route([], client, settings)

    assert client.calls == []
    assert selection.tools == []


# ------------------------------------------------------------- failing open


@pytest.mark.parametrize(
    "client",
    [
        FakeClient("not json at all"),
        FakeClient('{"tools": "git_commit"}'),      # right key, wrong shape
        FakeClient(None),                            # no text
        FakeClient(raises=RuntimeError("provider exploded")),
    ],
    ids=["unparseable", "wrong-shape", "empty", "raised"],
)
async def test_every_router_failure_offers_the_whole_pool(client, settings):
    selection = await route(POOL, client, settings)

    assert selection.ran is False
    assert selection.tools == POOL
    assert selection.reserve == []
    # A silent fallback would look identical to "it chose everything", so the
    # note is what makes the degradation visible in the transcript.
    assert selection.note


async def test_a_timeout_offers_the_whole_pool(tmp_path):
    impatient = Settings(
        workspace_root=tmp_path, tool_router_threshold=4, tool_router_timeout=0.01
    )
    client = FakeClient('{"tools": ["git_commit"]}', delay=0.5)
    selection = await route(POOL, client, impatient)

    assert selection.ran is False
    assert selection.tools == POOL
    assert "timed out" in (selection.note or "")


async def test_no_client_offers_the_whole_pool_with_the_callers_note(settings):
    selection = await route(POOL, None, settings, unavailable_note="key missing")

    assert selection.ran is False
    assert selection.tools == POOL
    assert selection.note == "key missing"


async def test_an_empty_pick_on_a_pool_without_core_tools_offers_everything(settings):
    """Zero tools on a guess is worse than the full list."""
    coreless = [tool("alpha"), tool("beta"), tool("gamma"), tool("delta"), tool("eps")]
    client = FakeClient('{"tools": []}')
    selection = await select_tools(
        pool=coreless, user_message="hi", client=client, settings=settings
    )

    assert selection.ran is False
    assert selection.tools == coreless


async def test_an_empty_pick_still_keeps_the_core_floor_when_it_exists(settings):
    """A genuinely tool-free question narrows to the floor, not to everything."""
    client = FakeClient('{"tools": [], "reason": "Just conversation."}')
    selection = await route(POOL, client, settings)

    assert selection.ran is True
    assert set(selection.selected_names) == set(CORE_TOOL_NAMES) | {
        REQUEST_TOOLS_TOOL_NAME
    }


# ------------------------------------------------------------- the catalog


async def test_the_catalog_is_far_smaller_than_the_schemas_it_replaces(settings):
    """The whole feature is a token trade, so this is the load-bearing property."""
    client = FakeClient('{"tools": ["git_commit"]}')
    await route(POOL, client, settings)

    (history, tools, _system) = client.calls[0]
    prompt = history[0]["content"]

    assert tools == []                        # the router is asked for JSON
    for t in POOL:
        assert t.name in prompt
    # No JSON Schema leaked into the catalog.
    assert "input_schema" not in prompt
    assert "properties" not in prompt
    # And the second sentence of each description was clipped away.
    assert "ignore" not in prompt


def test_first_sentence_clips_at_the_sentence_and_at_the_limit():
    assert first_sentence("One. Two. Three.") == "One."
    assert first_sentence("a" * 500).endswith("…")
    assert first_sentence("") == ""


def test_catalog_names_the_group_so_the_router_can_reason_by_domain():
    line = catalog_lines([tool("git_commit", "Version Control")])
    assert "git_commit" in line and "[Version Control]" in line


# ------------------------------------------------------------------ parsing


def test_parse_tolerates_fences_and_surrounding_prose():
    names, reason = parse_selection(
        'Sure!\n```json\n{"tools": ["a", "b"], "reason": "why"}\n```\nHope that helps.'
    )
    assert names == ["a", "b"]
    assert reason == "why"


def test_parse_drops_non_string_entries():
    names, _ = parse_selection('{"tools": ["a", 3, null, "b", ""]}')
    assert names == ["a", "b"]


@pytest.mark.parametrize("text", ["", None, "no json here", '["a"]'])
def test_parse_rejects_what_it_cannot_read(text):
    with pytest.raises(ValueError):
        parse_selection(text)


# ------------------------------------------------------------- the resume


def test_restore_replays_a_stored_selection_without_a_call():
    restored = restore_selection(POOL, ["read_file", "git_commit"], ["zeta"])

    assert restored is not None
    assert restored.selected_names == ["read_file", "git_commit", REQUEST_TOOLS_TOOL_NAME]
    assert restored.reserve_names == ["zeta"]


def test_restore_returns_none_for_a_session_that_never_routed():
    assert restore_selection(POOL, None, None) is None


def test_restore_of_a_whole_pool_adds_no_escape_hatch():
    every = [t.name for t in POOL]
    restored = restore_selection(POOL, every, [])
    assert restored is not None
    assert REQUEST_TOOLS_TOOL_NAME not in restored.selected_names
