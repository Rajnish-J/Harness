"""propose_create_project: a tool that only ever proposes, never executes.

Unlike an ordinary tool call, this one force-parks the turn even in agent mode
-- creating a project is a one-way door, so it is never auto-run the way
write_file is (see the `proposal_ids` branch in app/agent/loop.py's `_drive`).
Same FakeClient harness as test_tool_modes.py: the behaviour under test is the
loop's, not the model's.
"""

from typing import Any

import pytest

from app.agent.llm.base import LLMTurn, ToolCallRequest
from app.agent.loop import resume_agent_loop, run_agent_loop
from app.agent.session import Session
from app.agent.tools.project_tools import PROPOSE_CREATE_PROJECT_TOOL
from app.core.config import get_settings

from .test_tool_modes import FakeClient, answer, tool_use


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


@pytest.fixture
def session():
    return Session(session_id="s1", provider="anthropic")


async def collect(stream) -> list[Any]:
    return [event async for event in stream]


@pytest.mark.asyncio
async def test_proposal_force_parks_even_in_agent_mode(settings, session):
    """No require_approval is passed -- this is otherwise plain agent mode."""
    client = FakeClient(
        [
            tool_use(
                "propose_create_project",
                {"name": "expense-tracker", "description": "Track expenses."},
            )
        ]
    )

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="let's build an expense tracker",
            tools=[PROPOSE_CREATE_PROJECT_TOOL],
        )
    )

    assert [event.type for event in events] == ["project_proposal", "done"]
    assert events[0].name == "expense-tracker"
    assert events[0].description == "Track expenses."
    assert events[-1].reason == "awaiting_approval"
    assert session.pending is not None
    assert session.pending[0].name == "propose_create_project"


@pytest.mark.asyncio
async def test_mixed_batch_parks_both_with_the_right_event_types(settings, session):
    """A proposal alongside an ordinary tool call parks the whole batch."""
    mixed_turn = LLMTurn(
        text=None,
        tool_calls=[
            ToolCallRequest(
                id="call-1", name="propose_create_project", arguments={"name": "todo-app"}
            ),
            ToolCallRequest(id="call-2", name="list_directory", arguments={}),
        ],
        stop_reason="tool_use",
    )
    client = FakeClient([mixed_turn])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="let's build a todo app",
            tools=[PROPOSE_CREATE_PROJECT_TOOL],
        )
    )

    assert [event.type for event in events] == [
        "project_proposal",
        "approval_request",
        "done",
    ]
    assert events[0].id == "call-1"
    assert events[1].id == "call-2"
    assert events[1].name == "list_directory"
    assert session.pending is not None
    assert {call.id for call in session.pending} == {"call-1", "call-2"}


@pytest.mark.asyncio
async def test_approving_runs_the_canned_response_and_finishes(settings, session):
    client = FakeClient(
        [
            tool_use(
                "propose_create_project",
                {"name": "expense-tracker", "description": "Track expenses."},
            ),
            answer("Great, let me know when it's ready."),
        ]
    )

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="let's build an expense tracker",
            tools=[PROPOSE_CREATE_PROJECT_TOOL],
        )
    )

    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": True},
            tools=[PROPOSE_CREATE_PROJECT_TOOL],
        )
    )

    assert [event.type for event in events] == [
        "tool_result",
        "assistant_message",
        "done",
    ]
    result = events[0]
    assert not result.is_error
    assert "do not attempt to create it yourself" in result.content
    assert session.pending is None


@pytest.mark.asyncio
async def test_declining_tells_the_model_not_to_retry(settings, session):
    client = FakeClient(
        [
            tool_use("propose_create_project", {"name": "expense-tracker"}),
            answer("Understood, what would you like instead?"),
        ]
    )

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="let's build an expense tracker",
            tools=[PROPOSE_CREATE_PROJECT_TOOL],
        )
    )

    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": False},
            tools=[PROPOSE_CREATE_PROJECT_TOOL],
        )
    )

    result = next(event for event in events if event.type == "tool_result")
    assert result.is_error
    assert "denied" in result.content.lower()
    # A denial is an observation, not a dead end: the loop carried on.
    assert events[-1].reason == "end_turn"
