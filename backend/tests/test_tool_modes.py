"""Tool modes: chat (no tools), manual (approve first), agent (unchanged).

Manual mode is a two-request protocol, so what matters here is that the pause
is complete — nothing dispatched, history left resumable — and that the resume
honours the verdicts. A fake LLM client stands in for the provider: the
behaviour under test is the loop's, not the model's.
"""

from typing import Any

import pytest

from app.agent.llm.base import LLMTurn, ToolCallRequest, ToolResult
from app.agent.loop import resume_agent_loop, run_agent_loop
from app.agent.session import Session
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import get_settings
from app.models.chat import ApprovalRequest, ChatRequest


class FakeClient:
    """Replays a scripted list of turns, recording what it was asked to send."""

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


def tool_use(name: str, arguments: dict[str, Any], call_id: str = "call-1") -> LLMTurn:
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


async def collect(stream) -> list[Any]:
    return [event async for event in stream]


# ---------------------------------------------------------------- the wire


def test_mode_defaults_to_agent():
    """The pre-mode request shape must keep behaving exactly as it did."""
    assert ChatRequest(session_id="s", message="hi").mode == "agent"


def test_mode_is_constrained():
    with pytest.raises(ValueError):
        ChatRequest(session_id="s", message="hi", mode="yolo")


def test_approval_request_needs_no_message():
    req = ApprovalRequest(
        session_id="s", decisions=[{"id": "call-1", "approved": True}]
    )
    assert req.decisions[0].approved is True
    # It carries the preset too, so the resumed turn is rebuilt identically.
    assert req.mode == "agent"


# ---------------------------------------------------------------- chat mode


@pytest.mark.asyncio
async def test_chat_mode_advertises_no_tools(settings, session):
    client = FakeClient([answer("No tools needed.")])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="hello",
            tools=[],
        )
    )

    assert client.sent_tools == [[]]
    assert [event.type for event in events] == ["assistant_message", "done"]


@pytest.mark.asyncio
async def test_chat_mode_refuses_a_hallucinated_call(settings, session, tmp_path):
    """An empty toolset gates dispatch, not just the advertised schemas."""
    client = FakeClient(
        [
            tool_use("write_file", {"path": "pwned.txt", "content": "no"}),
            answer("Sorry, I cannot."),
        ]
    )

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="write a file",
            tools=[],
        )
    )

    result = next(event for event in events if event.type == "tool_result")
    assert result.is_error
    assert not (tmp_path / "pwned.txt").exists()


# -------------------------------------------------------------- manual mode


@pytest.mark.asyncio
async def test_manual_mode_parks_before_dispatching(settings, session, tmp_path):
    client = FakeClient([tool_use("write_file", {"path": "x.txt", "content": "hi"})])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="write x.txt",
            require_approval=True,
        )
    )

    assert [event.type for event in events] == ["approval_request", "done"]
    assert events[-1].reason == "awaiting_approval"
    # Nothing ran, and the call is parked for the resume.
    assert not (tmp_path / "x.txt").exists()
    assert session.pending is not None
    assert session.pending[0].name == "write_file"
    # The assistant turn is already in history — that is what makes a resume
    # need nothing but the results.
    assert session.history[-1]["role"] == "assistant"


@pytest.mark.asyncio
async def test_approving_runs_the_call_and_finishes(settings, session, tmp_path):
    client = FakeClient(
        [
            tool_use("write_file", {"path": "x.txt", "content": "hi"}),
            answer("Wrote it."),
        ]
    )

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="write x.txt",
            require_approval=True,
        )
    )

    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": True},
        )
    )

    assert [event.type for event in events] == [
        "tool_result",
        "assistant_message",
        "done",
    ]
    assert (tmp_path / "x.txt").read_text() == "hi"
    assert session.pending is None


@pytest.mark.asyncio
async def test_denying_writes_nothing_and_tells_the_model(settings, session, tmp_path):
    client = FakeClient(
        [
            tool_use("write_file", {"path": "x.txt", "content": "hi"}),
            answer("Understood."),
        ]
    )

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="write x.txt",
            require_approval=True,
        )
    )

    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": False},
        )
    )

    result = next(event for event in events if event.type == "tool_result")
    assert result.is_error
    assert "denied" in result.content.lower()
    assert not (tmp_path / "x.txt").exists()
    # A denial is an observation, not a dead end: the loop carried on.
    assert events[-1].reason == "end_turn"


@pytest.mark.asyncio
async def test_a_call_with_no_verdict_is_denied(settings, session, tmp_path):
    """Silence must never authorise a write."""
    client = FakeClient(
        [
            tool_use("write_file", {"path": "x.txt", "content": "hi"}),
            answer("Understood."),
        ]
    )

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="write x.txt",
            require_approval=True,
        )
    )

    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={},
        )
    )

    assert next(e for e in events if e.type == "tool_result").is_error
    assert not (tmp_path / "x.txt").exists()


@pytest.mark.asyncio
async def test_resuming_twice_is_refused(settings, session):
    client = FakeClient(
        [tool_use("list_directory", {}), answer("Done."), answer("Done again.")]
    )

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="list",
            require_approval=True,
        )
    )
    await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": True},
        )
    )

    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": True},
        )
    )

    assert events[0].code == "no_pending_approval"
    assert events[-1].reason == "error"


@pytest.mark.asyncio
async def test_a_manual_turn_can_park_again(settings, session):
    """Approval is per call, not per turn: the next call asks again."""
    client = FakeClient(
        [
            tool_use("list_directory", {}, call_id="call-1"),
            tool_use("list_directory", {}, call_id="call-2"),
        ]
    )

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="look around twice",
            require_approval=True,
        )
    )
    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": True},
        )
    )

    assert [event.type for event in events] == [
        "tool_result",
        "approval_request",
        "done",
    ]
    assert session.pending[0].id == "call-2"


# --------------------------------------------------------------- agent mode


@pytest.mark.asyncio
async def test_agent_mode_still_runs_tools_itself(settings, session, tmp_path):
    client = FakeClient(
        [tool_use("write_file", {"path": "x.txt", "content": "hi"}), answer("Done.")]
    )

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="write x.txt",
        )
    )

    assert [event.type for event in events] == [
        "tool_call",
        "tool_result",
        "assistant_message",
        "done",
    ]
    assert (tmp_path / "x.txt").read_text() == "hi"
    assert session.pending is None
    # The full registry was advertised, as it was before modes existed.
    assert len(client.sent_tools[0]) == len(ALL_TOOLS)
