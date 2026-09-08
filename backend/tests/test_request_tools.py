"""The escape hatch out of a routed turn.

The tool router trims what a turn advertises before it starts. That trade is
only safe because the model can undo it mid-turn, so what these tests pin is the
undo: a granted request widens the NEXT request's schemas, the widened tool is
actually dispatchable, and a request for something genuinely withheld is a plain
answer rather than an error the model will retry forever.

A fake LLM client stands in for the provider, as in test_tool_modes.py -- the
behaviour under test is the loop's, not the model's.
"""

from typing import Any

import pytest

from app.agent.llm.base import LLMTurn, ToolCallRequest, ToolResult
from app.agent.loop import resume_agent_loop, run_agent_loop
from app.agent.session import Session
from app.agent.tools.meta.request_tools import (
    REQUEST_TOOLS_TOOL,
    normalize_names,
    request_tools,
    resolve_requested,
)
from app.agent.tools.registry import TOOLS_BY_NAME
from app.core.config import get_settings


class FakeClient:
    """Replays scripted turns, recording the tool schemas it was sent each time."""

    provider = "anthropic"

    def __init__(self, turns: list[LLMTurn]) -> None:
        self._turns = list(turns)
        self.sent_tools: list[list[dict[str, Any]]] = []

    def tool_schemas(self, tools: list[Any]) -> list[dict[str, Any]]:
        return [{"name": tool.name} for tool in tools]

    def user_message(self, text: str) -> dict[str, Any]:
        return {"role": "user", "content": text}

    async def send(self, history, tools, system) -> LLMTurn:
        self.sent_tools.append(tools)
        if not self._turns:
            raise AssertionError("FakeClient ran out of scripted turns")
        return self._turns.pop(0)

    def append_assistant_turn(self, history: list[Any], turn: LLMTurn) -> None:
        history.append({"role": "assistant", "turn": turn})

    def append_tool_results(
        self, history: list[Any], results: list[tuple[ToolCallRequest, ToolResult]]
    ) -> None:
        history.append({"role": "user", "results": results})


def tool_use(name, arguments, call_id="call-1") -> LLMTurn:
    return LLMTurn(
        text=None,
        tool_calls=[ToolCallRequest(id=call_id, name=name, arguments=arguments)],
        stop_reason="tool_use",
    )


def answer(text: str) -> LLMTurn:
    return LLMTurn(text=text, tool_calls=[], stop_reason="end_turn")


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


@pytest.fixture
def session():
    return Session(session_id="s1", provider="anthropic")


#: A deliberately tiny routed turn: one real tool advertised, one held back.
ACTIVE = [TOOLS_BY_NAME["list_directory"], REQUEST_TOOLS_TOOL]
RESERVE = [TOOLS_BY_NAME["read_file"]]


def names_sent(client: FakeClient, index: int) -> list[str]:
    return [schema["name"] for schema in client.sent_tools[index]]


async def collect(stream) -> list[Any]:
    return [event async for event in stream]


# --------------------------------------------------------------- the widening


async def test_a_granted_request_widens_the_next_request(settings, session, tmp_path):
    (tmp_path / "note.txt").write_text("hello", encoding="utf-8")
    client = FakeClient([
        tool_use("request_tools", {"names": ["read_file"]}),
        tool_use("read_file", {"path": "note.txt"}, "call-2"),
        answer("done"),
    ])

    events = await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="read note.txt", tools=ACTIVE, tool_reserve=RESERVE,
    ))

    # The first decision saw only the routed toolset.
    assert names_sent(client, 0) == ["list_directory", "request_tools"]
    # The second saw the grant -- APPENDED, so every existing index is
    # untouched and the cached prompt prefix survives.
    assert names_sent(client, 1) == ["list_directory", "request_tools", "read_file"]

    # And the widened tool really ran, rather than merely being advertised.
    results = [e for e in events if e.type == "tool_result"]
    assert results[-1].content == "hello"
    assert not results[-1].is_error


async def test_the_grant_is_reported_to_the_model(settings, session):
    client = FakeClient([
        tool_use("request_tools", {"names": ["read_file"]}),
        answer("done"),
    ])
    events = await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
    ))

    grant = [e for e in events if e.type == "tool_result"][0]
    assert not grant.is_error
    assert "read_file" in grant.content
    assert "Added to this turn" in grant.content


async def test_a_tool_outside_the_reserve_is_answered_not_errored(settings, session):
    """It was withheld deliberately. An error would invite a retry loop."""
    client = FakeClient([
        tool_use("request_tools", {"names": ["run_command"]}),
        answer("fine"),
    ])
    events = await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
    ))

    result = [e for e in events if e.type == "tool_result"][0]
    assert not result.is_error
    assert "Not available" in result.content
    assert "do not ask again" in result.content
    # Nothing was widened.
    assert names_sent(client, 1) == ["list_directory", "request_tools"]


async def test_a_partial_request_grants_what_it_can(settings, session):
    client = FakeClient([
        tool_use("request_tools", {"names": ["read_file", "run_command"]}),
        answer("done"),
    ])
    events = await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
    ))

    result = [e for e in events if e.type == "tool_result"][0]
    assert "Added to this turn: read_file" in result.content
    assert "Not available: run_command" in result.content
    assert "read_file" in names_sent(client, 1)


async def test_a_second_request_cannot_regrant_the_same_tool(settings, session):
    """The reserve shrinks as it is spent, so a repeat is honestly refused."""
    client = FakeClient([
        tool_use("request_tools", {"names": ["read_file"]}, "c1"),
        tool_use("request_tools", {"names": ["read_file"]}, "c2"),
        answer("done"),
    ])
    events = await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
    ))

    second = [e for e in events if e.type == "tool_result"][1]
    assert "Not available" in second.content
    # Still granted exactly once -- no duplicate schema.
    assert names_sent(client, 2).count("read_file") == 1


async def test_a_malformed_request_changes_nothing(settings, session):
    client = FakeClient([
        tool_use("request_tools", {"names": 42}),
        answer("ok"),
    ])
    events = await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
    ))

    result = [e for e in events if e.type == "tool_result"][0]
    assert "non-empty list" in result.content
    assert names_sent(client, 1) == ["list_directory", "request_tools"]


async def test_an_unrouted_turn_has_nothing_to_grant(settings, session):
    """No reserve means no widening, and no crash on the attempt."""
    client = FakeClient([
        tool_use("request_tools", {"names": ["read_file"]}),
        answer("ok"),
    ])
    events = await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=[],
    ))

    result = [e for e in events if e.type == "tool_result"][0]
    assert "Not available" in result.content
    assert names_sent(client, 1) == ["list_directory", "request_tools"]


# ------------------------------------------------------------- manual mode


async def test_approving_a_request_widens_the_resumed_turn(settings, session, tmp_path):
    """request_tools parks for approval like anything else, and must still grant."""
    (tmp_path / "note.txt").write_text("hi", encoding="utf-8")
    client = FakeClient([tool_use("request_tools", {"names": ["read_file"]}, "c1")])

    await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
        require_approval=True,
    ))
    assert session.pending and session.pending[0].name == "request_tools"

    client._turns = [answer("done")]
    await collect(resume_agent_loop(
        session=session, llm_client=client, settings=settings,
        decisions={"c1": True}, tools=ACTIVE, tool_reserve=RESERVE,
    ))

    # The decision after the resume was made against the widened toolset.
    assert "read_file" in names_sent(client, -1)


async def test_a_denied_request_widens_nothing(settings, session):
    client = FakeClient([tool_use("request_tools", {"names": ["read_file"]}, "c1")])
    await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
        require_approval=True,
    ))

    client._turns = [answer("done")]
    await collect(resume_agent_loop(
        session=session, llm_client=client, settings=settings,
        decisions={"c1": False}, tools=ACTIVE, tool_reserve=RESERVE,
    ))

    assert "read_file" not in names_sent(client, -1)


# ------------------------------------------------------------------- units


def test_the_hatch_is_not_in_the_registry():
    """It must never reach /tools, the disable list, or ALL_TOOLS' order."""
    assert REQUEST_TOOLS_TOOL.name not in TOOLS_BY_NAME


@pytest.mark.parametrize(
    "value,expected",
    [
        (["a", "b"], ["a", "b"]),
        ("a", ["a"]),          # some models send a bare string for one item
        ("", []),
        (["a", 3, None, ""], ["a"]),
        (42, []),
        (None, []),
    ],
)
def test_normalize_names(value, expected):
    assert normalize_names(value) == expected


def test_resolve_requested_partitions_by_the_reserve():
    granted, unknown = resolve_requested(["a", "b"], {"a"})
    assert granted == ["a"] and unknown == ["b"]


def test_run_reports_both_halves():
    message = request_tools(names=["a", "b"], tool_reserve_names={"a"})
    assert "Added to this turn: a" in message
    assert "Not available: b" in message


# --------------------------------------------- surviving a second approval


async def test_a_grant_survives_the_next_approval_round_trip(settings, session):
    """Manual mode parks on every call, so a routed turn crosses the boundary
    more than once. The grant is recorded on the session, because that is what
    _prepare_turn rebuilds each resume from -- otherwise the second resume
    restores the original narrow selection and refuses a tool the first resume
    already granted, with that tool's own tool_use block sitting in history.
    """
    session.selected_tool_names = [t.name for t in ACTIVE]
    session.reserve_tool_names = [t.name for t in RESERVE]

    client = FakeClient([tool_use("request_tools", {"names": ["read_file"]}, "c1")])
    await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE, require_approval=True,
    ))

    # Approve the request; the model then asks for the tool it was just given.
    client._turns = [tool_use("read_file", {"path": "note.txt"}, "c2")]
    await collect(resume_agent_loop(
        session=session, llm_client=client, settings=settings,
        decisions={"c1": True}, tools=ACTIVE, tool_reserve=RESERVE,
    ))

    assert "read_file" in (session.selected_tool_names or [])
    assert "read_file" not in (session.reserve_tool_names or [])


async def test_an_unrouted_turn_never_gains_a_stored_selection(settings, session):
    """Storing one here would pin every later resume to this turn's toolset."""
    assert session.selected_tool_names is None

    client = FakeClient([
        tool_use("request_tools", {"names": ["read_file"]}),
        answer("done"),
    ])
    await collect(run_agent_loop(
        session=session, llm_client=client, settings=settings,
        user_message="go", tools=ACTIVE, tool_reserve=RESERVE,
    ))

    assert session.selected_tool_names is None
    assert session.reserve_tool_names is None
