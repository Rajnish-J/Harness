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
    _assemble,
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


# ------------------------------------------------- registered-but-unattached
#
# Tools from a server the user registered on /mcp but did not attach to this
# chat. The router is shown them so it can notice a request needs one; it is
# never allowed to hand one to the model. Naming one asks the user instead.

CANDIDATES = [
    tool("mcp__github__list_repos", "MCP · github"),
    tool("mcp__github__create_issue", "MCP · github"),
    tool("mcp__slack__post", "MCP · slack"),
]


async def test_a_candidate_is_never_selected_only_requested(settings):
    client = FakeClient(
        '{"tools": ["mcp__github__list_repos"], "reason": "Listing repos."}'
    )
    selection = await route(POOL, client, settings, candidates=CANDIDATES)

    # The whole safety story: it asked for a server, it did not gain a tool.
    assert selection.needs_servers == ["github"]
    assert "mcp__github__list_repos" not in selection.selected_names
    assert "mcp__github__list_repos" not in selection.reserve_names
    # And it must not have leaked into the reserve either, or request_tools
    # could pull an unauthorised server's tool in mid-turn.
    assert all(not name.startswith("mcp__slack__") for name in selection.selected_names)


async def test_candidates_are_offered_in_the_catalog_and_marked(settings):
    client = FakeClient('{"tools": [], "reason": ""}')
    await route(POOL, client, settings, candidates=CANDIDATES)

    prompt = client.calls[0][0][0]["content"]
    assert "mcp__github__list_repos (NEEDS PERMISSION)" in prompt
    # An ordinary pool tool carries no marker, or the distinction is worthless.
    assert "git_commit (NEEDS PERMISSION)" not in prompt


async def test_two_servers_are_both_reported_once_each(settings):
    client = FakeClient(
        '{"tools": ["mcp__github__list_repos", "mcp__github__create_issue", '
        '"mcp__slack__post"], "reason": "Both."}'
    )
    selection = await route(POOL, client, settings, candidates=CANDIDATES)

    assert selection.needs_servers == ["github", "slack"]


async def test_a_pick_of_only_candidates_still_parks(settings):
    """The pool has no core tools, so `keep` is empty -- but the answer is real.

    Failing open here would run the turn with every tool and still not be able
    to do the thing, which is exactly the silent failure this feature ends.
    """
    pool = [tool("alpha"), tool("zeta")]
    client = FakeClient(
        '{"tools": ["mcp__github__list_repos"], "reason": "Needs GitHub."}'
    )
    selection = await select_tools(
        pool=pool,
        user_message="what repos do I have",
        client=client,
        settings=Settings(workspace_root=settings.workspace_root, tool_router_threshold=1),
        candidates=CANDIDATES,
    )

    assert selection.ran is True
    assert selection.needs_servers == ["github"]


async def test_a_router_failure_never_asks_for_a_server(settings):
    """Fail-open must not become fail-ask: a timeout cannot park a turn."""
    client = FakeClient(raises=RuntimeError("boom"))
    selection = await route(POOL, client, settings, candidates=CANDIDATES)

    assert selection.ran is False
    assert selection.needs_servers == []
    assert selection.selected_names == [t.name for t in POOL]


async def test_candidates_alone_are_worth_a_routing_call_below_threshold(settings):
    """A small pool still routes when there is a server it might need.

    Below the threshold the router normally does not run at all. That is right
    for narrowing and wrong here: skipping the call is how the model ends up
    apologising for a capability the user already registered.
    """
    small = [tool("alpha"), tool("read_file")]
    client = FakeClient(
        '{"tools": ["mcp__github__list_repos"], "reason": "Needs GitHub."}'
    )
    selection = await select_tools(
        pool=small,
        user_message="what repos do I have",
        client=client,
        settings=settings,  # threshold 4, len(small) is 2
        candidates=CANDIDATES,
    )

    assert client.calls, "the router should have been consulted"
    assert selection.needs_servers == ["github"]


async def test_no_candidates_leaves_the_threshold_shortcut_intact(settings):
    """The other half of the rule above: without candidates, nothing changes."""
    small = [tool("alpha"), tool("read_file")]
    client = FakeClient('{"tools": ["alpha"], "reason": "x"}')
    selection = await route(small, client, settings, candidates=[])

    assert client.calls == [], "a small pool with nothing to ask about must not route"
    assert selection.ran is False


async def test_a_hallucinated_name_is_still_dropped_not_treated_as_a_server(settings):
    client = FakeClient('{"tools": ["not_a_real_tool"], "reason": "x"}')
    selection = await route(POOL, client, settings, candidates=CANDIDATES)

    assert selection.needs_servers == []
    assert "not_a_real_tool" not in selection.selected_names


async def test_ordering_survives_candidates(settings):
    """The pool-order invariant is unaffected by the partition above it."""
    client = FakeClient(
        '{"tools": ["zeta", "git_commit", "mcp__github__list_repos"], "reason": "x"}'
    )
    selection = await route(POOL, client, settings, candidates=CANDIDATES)

    picked = [n for n in selection.selected_names if n != REQUEST_TOOLS_TOOL_NAME]
    assert picked == sorted(picked, key=[t.name for t in POOL].index)


def test_the_hatch_is_built_with_this_turn_s_reserve_in_its_schema():
    """The router is what makes the enum useful: it knows what was held back.

    Without this the hatch ships an open-ended string and the model has to
    guess a name it has never been shown -- which is how a real turn ended up
    asking for `mcp__github__list_user_repos`, a tool that does not exist.
    """
    pool = [
        tool("read_file"),
        tool("mcp__github__search_repositories"),
        tool("mcp__github__list_commits"),
    ]

    selection = _assemble(pool, {"read_file"}, reason="", model=None)

    hatch = next(t for t in selection.tools if t.name == REQUEST_TOOLS_TOOL_NAME)
    assert hatch.input_schema["properties"]["names"]["items"]["enum"] == [
        "mcp__github__list_commits",
        "mcp__github__search_repositories",
    ]


def test_a_resumed_turn_advertises_the_same_names():
    """A resume must offer exactly what the first pass did, enum included."""
    pool = [
        tool("read_file"),
        tool("mcp__github__search_repositories"),
    ]

    restored = restore_selection(
        pool, ["read_file"], ["mcp__github__search_repositories"]
    )

    hatch = next(t for t in restored.tools if t.name == REQUEST_TOOLS_TOOL_NAME)
    assert hatch.input_schema["properties"]["names"]["items"]["enum"] == [
        "mcp__github__search_repositories"
    ]


async def test_a_mixed_pick_runs_rather_than_parking(settings):
    """Naming a server AND real tools is not a reason to stop and ask.

    Parking costs the user an interruption and a round trip, so it is worth it
    only when the turn cannot otherwise proceed. A pick that also named usable
    tools can make progress: the server is an enhancement, and the right move
    is to run with what was chosen rather than block on permission for the rest.
    """
    client = FakeClient(
        '{"tools": ["git_commit", "mcp__github__list_repos"], '
        '"reason": "Commit, and repos if allowed."}'
    )
    selection = await route(POOL, client, settings, candidates=CANDIDATES)

    assert selection.needs_servers == []
    assert "git_commit" in selection.selected_names
    # Still never granted: not parking must not turn into quietly widening.
    assert "mcp__github__list_repos" not in selection.selected_names
    assert "mcp__github__list_repos" not in selection.reserve_names


async def test_the_core_floor_alone_is_not_a_reason_to_skip_parking(settings):
    """The floor is added to every selection, so it proves nothing.

    Counting it as "the turn can proceed" would silently disable parking
    everywhere, because `keep` is never empty once the floor is in it.
    """
    client = FakeClient(
        '{"tools": ["mcp__github__list_repos"], "reason": "Needs github."}'
    )
    selection = await route(POOL, client, settings, candidates=CANDIDATES)

    # The floor IS present...
    assert {"read_file", "list_directory", "search_files"} <= set(
        selection.selected_names
    )
    # ...and the turn parks anyway.
    assert selection.needs_servers == ["github"]
