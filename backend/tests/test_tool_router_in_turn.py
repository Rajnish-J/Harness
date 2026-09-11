"""Routing as _prepare_turn actually applies it.

Drives the real `_prepare_turn`, the way test_tool_settings.py and
test_mcp_in_turn.py do -- one layer below the model call, which is as far as
this environment reaches. What that proves is the part that matters: the toolset
the turn carries IS what the request advertises and the loop dispatches from.

The load-bearing cases are the two that are easy to get backwards:

- routing runs AFTER the /tools disable list, so it can never re-offer something
  switched off there;
- the approve path replays the first turn's selection instead of routing again,
  because `session.history` already holds tool_use blocks naming it.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.agent.llm.base import LLMTurn
from app.agent.session import session_store
from app.agent.tools.meta.request_tools import REQUEST_TOOLS_TOOL_NAME
from app.api import chat as chat_api
from app.core.config import Settings
from app.mcp.manager import McpManager
from app.models.chat import ApprovalRequest, ChatRequest


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        anthropic_api_key="test-key",
        workspace_root=tmp_path,
        mock_mcp=True,
        # ALL_TOOLS is well over this, so the default path routes.
        tool_router_threshold=5,
    )


def request_with(settings: Settings) -> SimpleNamespace:
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(pool=None, mcp=McpManager(settings)))
    )


class FakeRouterClient:
    provider = "fake"

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0

    def user_message(self, text: str) -> dict:
        return {"role": "user", "content": text}

    async def send(self, history, tools, system) -> LLMTurn:
        self.calls += 1
        return LLMTurn(text=self.reply, tool_calls=[], stop_reason="end_turn")


@pytest.fixture
def router(monkeypatch: pytest.MonkeyPatch):
    """Swap the router's client for a scripted one; return the spy."""

    def _install(reply: str) -> FakeRouterClient:
        client = FakeRouterClient(reply)

        async def _fake(pool, settings, credentials, turn_client, turn_model):
            return client, "fake-router-model", None

        monkeypatch.setattr(chat_api, "_router_client", _fake)
        return client

    return _install


@pytest.fixture(autouse=True)
def clean_sessions():
    """Each test gets its own session id, but the store is process-wide."""
    yield
    session_store.reset("router-test")


async def prepare(request, settings, *, message="commit my work", **payload):
    """The fresh path: _chat_stream is the only caller that passes a message."""
    return await chat_api._prepare_turn(
        request,
        ChatRequest(session_id="router-test", message=message, **payload),
        settings,
        user_message=message,
    )


def names_of(turn) -> list[str]:
    return [tool.name for tool in turn.tools]


# ------------------------------------------------------------------ narrowing


async def test_a_fresh_turn_is_narrowed(settings, router):
    spy = router('{"tools": ["git_commit", "git_status"], "reason": "Committing."}')
    turn, _ = await prepare(request_with(settings), settings)

    assert spy.calls == 1
    names = names_of(turn)
    assert "git_commit" in names and "git_status" in names
    # The floor, and the way back out.
    assert "read_file" in names
    assert REQUEST_TOOLS_TOOL_NAME in names
    # Far short of the whole registry.
    assert len(names) < 20
    assert turn.tool_reserve


async def test_the_global_chats_own_tools_survive_routing(settings, router):
    """They are appended after routing, and are not the router's to withhold."""
    router('{"tools": ["git_commit"]}')
    turn, _ = await prepare(request_with(settings), settings)

    names = names_of(turn)
    reserve = [t.name for t in turn.tool_reserve]
    for own in ("propose_create_project", "list_projects", "propose_attach_project"):
        assert own in names
        # Never held back either: they are not in the pool the router saw.
        assert own not in reserve


async def test_routing_cannot_re_offer_a_globally_disabled_tool(
    settings, router, monkeypatch
):
    """The disable list is subtracted first, so it is not in the pool to pick."""

    async def _disabled(_pool):
        return {"git_commit"}

    async def _no_memories(_pool, _project_id, _session_id=None):
        return []

    monkeypatch.setattr("app.db.registry_repo.list_disabled_tool_names", _disabled)
    monkeypatch.setattr("app.db.memory_repo.list_active", _no_memories)
    router('{"tools": ["git_commit", "git_status"]}')

    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(pool=object(), mcp=McpManager(settings))
        )
    )
    turn, _ = await prepare(request, settings)

    assert "git_commit" not in names_of(turn)
    assert "git_commit" not in [t.name for t in turn.tool_reserve]
    assert "git_status" in names_of(turn)


# ------------------------------------------------------------------- the event


async def test_the_selection_reaches_the_transcript(settings, router):
    router('{"tools": ["git_commit"], "reason": "Committing."}')
    turn, _ = await prepare(request_with(settings), settings)

    event = turn.selection_event
    assert event is not None
    assert event.ran is True
    assert event.reason == "Committing."
    assert event.model == "fake-router-model"
    assert event.pool_size > len(event.selected)
    # Groups travel with the names so the UI need not re-fetch the catalog.
    assert all(item["group"] for item in event.selected)


async def test_a_fail_open_is_visible_rather_than_silent(settings, router):
    router("not json")
    turn, _ = await prepare(request_with(settings), settings)

    event = turn.selection_event
    assert event is not None
    assert event.ran is False
    assert event.note
    # And the turn kept everything.
    assert len(names_of(turn)) > 40


async def test_the_event_persists_as_a_select_tools_row(settings, router):
    router('{"tools": ["git_commit"]}')
    turn, _ = await prepare(request_with(settings), settings)

    entry = chat_api._entry_for(turn.selection_event)
    assert entry is not None
    # Reuses the existing chat_role enum rather than needing a migration.
    assert entry.role == "tool_call"
    assert entry.tool_name == "select_tools"
    assert entry.tool_call_id == turn.selection_event.id
    assert entry.tool_args["pool_size"] == turn.selection_event.pool_size


# ------------------------------------------------------------------ the resume


async def test_the_approve_path_replays_and_does_not_route_again(settings, router):
    spy = router('{"tools": ["git_commit"]}')
    request = request_with(settings)

    first, _ = await prepare(request, settings)
    assert spy.calls == 1

    resumed, _ = await chat_api._prepare_turn(
        request,
        ApprovalRequest(session_id="router-test", decisions=[]),
        settings,
    )

    # No second call, and the identical toolset -- history already names it.
    assert spy.calls == 1
    assert names_of(resumed) == names_of(first)


async def test_a_session_that_never_routed_resumes_with_everything(settings):
    """Sessions predating the router have no stored selection to replay."""
    turn, _ = await chat_api._prepare_turn(
        request_with(settings),
        ApprovalRequest(session_id="router-test", decisions=[]),
        settings,
    )
    assert len(names_of(turn)) > 40
    assert turn.selection_event is None


# -------------------------------------------------------------- the off switch


async def test_chat_mode_advertises_nothing_and_routes_nothing(settings, router):
    spy = router('{"tools": ["git_commit"]}')
    turn, _ = await prepare(request_with(settings), settings, mode="chat")

    assert turn.tools == []
    assert turn.tool_reserve == []
    assert turn.selection_event is None
    assert spy.calls == 0


async def test_the_composer_switch_turns_routing_off(settings, router):
    spy = router('{"tools": ["git_commit"]}')
    turn, _ = await prepare(request_with(settings), settings, auto_select_tools=False)

    assert spy.calls == 0
    assert len(names_of(turn)) > 40
    assert turn.selection_event is None


async def test_a_hand_picked_toolset_is_below_the_threshold_and_skips_routing(
    settings, router
):
    spy = router('{"tools": ["read_file"]}')
    turn, _ = await prepare(
        request_with(settings), settings,
        tool_names=["read_file", "write_file", "git_status"],
    )

    assert spy.calls == 0
    assert turn.selection_event is None
    assert "write_file" in names_of(turn)


# ------------------------------------------------------- MCP consent parking
#
# A server registered on /mcp but not attached here. The router sees it, and a
# request that needs it stops the turn to ask rather than running a turn that
# cannot possibly succeed -- which is what produced a confident, wrong refusal.


def candidate_tool(name: str, server: str = "github"):
    from app.agent.tools.base import Tool
    from app.mcp.tools import mcp_group

    return Tool(
        name=name,
        description=f"[{server}] Does {name}.",
        input_schema={"type": "object", "properties": {}},
        run=lambda **_: "",
        group=mcp_group(server),
    )


@pytest.fixture
def candidates(monkeypatch: pytest.MonkeyPatch):
    """Pretend an enabled-but-unattached server offers these tools."""

    def _install(tools, ids=None):
        async def _fake(app, settings, attached_ids, exclude_ids=None):
            live = [
                t
                for t in tools
                if not (exclude_ids or set())
                & {(ids or {}).get(t.group.split(" · ")[-1], "")}
            ]
            return live, (ids or {"github": "gh-id"})

        monkeypatch.setattr(chat_api, "discover_candidate_tools", _fake)

    return _install


async def test_a_turn_that_needs_an_unattached_server_parks(
    settings, router, candidates
):
    candidates([candidate_tool("mcp__github__list_repos")])
    router('{"tools": ["mcp__github__list_repos"], "reason": "Listing repos."}')

    with pytest.raises(chat_api.McpConsentRequired) as parked:
        await prepare(
            request_with(settings), settings, message="what repos do I have"
        )

    event = parked.value.event
    assert event.servers == [{"id": "gh-id", "name": "github"}]
    assert event.reason == "Listing repos."
    # Nothing may have been written: the turn never ran, so declining must
    # leave no half-turn behind it.
    session = session_store.peek("router-test")
    assert session is None or session.history == []


async def test_an_ordinary_turn_is_unaffected_by_a_candidate_server(
    settings, router, candidates
):
    """The common case: a server is registered and simply not relevant."""
    candidates([candidate_tool("mcp__github__list_repos")])
    router('{"tools": ["git_commit"], "reason": "Committing."}')

    turn, _ = await prepare(request_with(settings), settings)

    assert "git_commit" in names_of(turn)
    # And the candidate never reached the turn, in either half.
    assert "mcp__github__list_repos" not in names_of(turn)
    assert "mcp__github__list_repos" not in [t.name for t in turn.tool_reserve]


async def test_a_declined_server_is_not_offered_again(
    settings, router, candidates, monkeypatch
):
    """Declining must be a decision, not a delay.

    Without this the next message routes again, names the same server again,
    and the user is asked the same question forever.
    """
    seen: dict[str, set] = {}

    async def _fake(app, s, attached_ids, exclude_ids=None):
        seen["excluded"] = set(exclude_ids or set())
        if "gh-id" in seen["excluded"]:
            return [], {}
        return [candidate_tool("mcp__github__list_repos")], {"github": "gh-id"}

    monkeypatch.setattr(chat_api, "discover_candidate_tools", _fake)
    router('{"tools": ["mcp__github__list_repos"], "reason": "Listing repos."}')

    with pytest.raises(chat_api.McpConsentRequired):
        await prepare(request_with(settings), settings, message="list my repos")

    # The user says no, which the decline endpoint records on the session.
    session = session_store.get_or_create("router-test", "anthropic")
    session.declined_mcp_server_ids.add("gh-id")

    # The same question, again. It must run this time rather than re-ask.
    turn, _ = await prepare(request_with(settings), settings, message="list my repos")
    assert turn is not None
    assert seen["excluded"] == {"gh-id"}


async def test_an_already_attached_server_never_parks_the_turn(
    settings, router, candidates
):
    """Approving must not lead straight back to the same question.

    discover_candidate_tools already excludes attached servers, so reaching
    this state means that filter regressed -- and the cost of the regression is
    an infinite loop: the user approves, the turn re-posts with the server
    attached, and parks on it again. Guarded locally so it cannot happen.
    """
    candidates([candidate_tool("mcp__github__list_repos")])
    router('{"tools": ["mcp__github__list_repos"], "reason": "Listing repos."}')

    turn, _ = await prepare(
        request_with(settings),
        settings,
        message="what repos do I have",
        mcp_server_ids=["gh-id"],
    )

    assert turn is not None


async def test_a_turn_that_can_proceed_is_not_parked(settings, router, candidates):
    """A server named ALONGSIDE usable tools is an enhancement, not a blocker.

    Parking here would throw away a selection the router already paid for and
    interrupt the user for permission they do not need yet.
    """
    candidates([candidate_tool("mcp__github__list_repos")])
    router(
        '{"tools": ["git_commit", "mcp__github__list_repos"], '
        '"reason": "Commit, and repos if allowed."}'
    )

    turn, _ = await prepare(request_with(settings), settings)

    assert "git_commit" in names_of(turn)
    # Still never granted without consent.
    assert "mcp__github__list_repos" not in names_of(turn)


async def test_the_prompt_names_only_servers_the_turn_can_actually_call(
    settings, router, monkeypatch
):
    """The bug that produced a hard 400 from Groq.

    The prompt told the model the github server was attached and authenticated
    while the router had held every one of its tools back. The model reached
    for one, the provider refused the whole request, and the turn died.
    """
    from app.agent.tools.base import Tool
    from app.mcp.tools import mcp_group

    github = Tool(
        name="mcp__github__get_me",
        description="[github] Who am I.",
        input_schema={"type": "object", "properties": {}},
        run=lambda **_: "",
        group=mcp_group("github"),
    )

    async def _resolve(app, settings_, ids):
        return [github], []

    monkeypatch.setattr(chat_api, "resolve_mcp_tools", _resolve)
    # Routed to a built-in, so every github tool lands in the reserve.
    router('{"tools": ["git_commit"], "reason": "Committing."}')

    turn, _ = await prepare(
        request_with(settings), settings, mcp_server_ids=["gh-id"]
    )

    assert "mcp__github__get_me" not in names_of(turn)
    assert "Connected MCP" not in turn.system
    assert "github" not in turn.system


async def test_a_server_whose_tools_survived_is_still_declared_authenticated(
    settings, router, monkeypatch
):
    """The other direction, or the fix would just be "never mention MCP".

    The block exists because a model handed thirty `mcp__github__*` tools with
    nothing saying they are authenticated asks the user for a token instead of
    calling one. That has to keep working whenever the tools ARE present.
    """
    from app.agent.tools.base import Tool
    from app.mcp.tools import mcp_group

    github = Tool(
        name="mcp__github__list_repos",
        description="[github] List repositories.",
        input_schema={"type": "object", "properties": {}},
        run=lambda **_: "",
        group=mcp_group("github"),
    )

    async def _resolve(app, settings_, ids):
        return [github], []

    monkeypatch.setattr(chat_api, "resolve_mcp_tools", _resolve)
    router('{"tools": ["mcp__github__list_repos"], "reason": "Listing repos."}')

    turn, _ = await prepare(
        request_with(settings),
        settings,
        message="what repos do I have",
        mcp_server_ids=["gh-id"],
    )

    assert "mcp__github__list_repos" in names_of(turn)
    assert "Connected MCP" in turn.system
    assert "already authenticated" in turn.system
    # And because the router held other tools back, it says how to get them.
    assert "request_tools" in turn.system
