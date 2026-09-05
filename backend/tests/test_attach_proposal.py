"""propose_attach_project: offering to file this conversation under a project.

Parks the turn the same way propose_create_project does, but resolves the
target's name from the database first -- the model supplies the id, so it may
name a project that does not exist.
"""

from dataclasses import dataclass
from typing import Any

import pytest

from app.agent.loop import resume_agent_loop, run_agent_loop
from app.agent.session import Session
from app.agent.tools.attach_tools import (
    LIST_PROJECTS_TOOL,
    PROPOSE_ATTACH_PROJECT_TOOL,
)
from app.agent.tools.project_tools import PROPOSE_CREATE_PROJECT_TOOL
from app.core.config import get_settings

from .test_tool_modes import FakeClient, answer, tool_use

PROJECT = "b5c00fe1-f7c2-463d-b0d1-97006f6ffe0c"


@dataclass
class FakeProject:
    id: str
    name: str


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


@pytest.fixture
def session():
    return Session(session_id="s1", provider="anthropic")


@pytest.fixture
def project(monkeypatch):
    """A resolvable target. Returning None simulates an invented id."""
    state = {"row": FakeProject(id=PROJECT, name="Task-Tracker")}

    async def fake_get(pool, project_id):
        return state["row"]

    monkeypatch.setattr("app.db.project_repo.get_project", fake_get)
    return state


async def collect(stream) -> list[Any]:
    return [event async for event in stream]


def attach_call(project_id: str = PROJECT, reason: str = "It adds CSV export."):
    return tool_use(
        "propose_attach_project",
        {"target_project_id": project_id, "reason": reason},
    )


async def test_attach_proposal_force_parks_even_in_agent_mode(
    settings, session, project
):
    """No require_approval is passed -- this is otherwise plain agent mode."""
    client = FakeClient([attach_call()])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="add CSV export to the task tracker",
            tools=[PROPOSE_ATTACH_PROJECT_TOOL],
            pool=object(),
        )
    )

    assert [event.type for event in events] == ["attach_proposal", "done"]
    assert events[-1].reason == "awaiting_approval"
    assert session.pending[0].name == "propose_attach_project"


async def test_the_event_carries_the_resolved_name_not_the_raw_id(
    settings, session, project
):
    client = FakeClient([attach_call()])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="add CSV export",
            tools=[PROPOSE_ATTACH_PROJECT_TOOL],
            pool=object(),
        )
    )

    proposal = events[0]
    assert proposal.project_id == PROJECT
    assert proposal.project_name == "Task-Tracker"
    assert proposal.reason == "It adds CSV export."


async def test_an_invented_id_degrades_to_an_approval_request(
    settings, session, project
):
    """A card naming a project that does not exist is worse than no card."""
    project["row"] = None

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=FakeClient([attach_call("not-a-real-id")]),
            settings=settings,
            user_message="file this somewhere",
            tools=[PROPOSE_ATTACH_PROJECT_TOOL],
            pool=object(),
        )
    )

    assert [event.type for event in events] == ["approval_request", "done"]
    # Still parked, so the human can deny it and the model learns to list first.
    assert events[-1].reason == "awaiting_approval"


async def test_a_missing_pool_degrades_to_an_approval_request(settings, session):
    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=FakeClient([attach_call()]),
            settings=settings,
            user_message="file this",
            tools=[PROPOSE_ATTACH_PROJECT_TOOL],
            pool=None,
        )
    )

    assert [event.type for event in events] == ["approval_request", "done"]


async def test_a_blank_target_degrades_rather_than_naming_nothing(
    settings, session, project
):
    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=FakeClient([attach_call("")]),
            settings=settings,
            user_message="file this",
            tools=[PROPOSE_ATTACH_PROJECT_TOOL],
            pool=object(),
        )
    )

    assert [event.type for event in events] == ["approval_request", "done"]


async def test_a_mixed_batch_parks_each_call_as_its_own_kind(
    settings, session, project
):
    """A create, an attach and an ordinary tool call in one turn."""
    from app.agent.llm.base import LLMTurn, ToolCallRequest

    client = FakeClient(
        [
            LLMTurn(
                text=None,
                stop_reason="tool_use",
                tool_calls=[
                    ToolCallRequest(
                        id="c1",
                        name="propose_create_project",
                        arguments={"name": "new-thing"},
                    ),
                    ToolCallRequest(
                        id="c2",
                        name="propose_attach_project",
                        arguments={"target_project_id": PROJECT},
                    ),
                    ToolCallRequest(
                        id="c3", name="list_projects", arguments={}
                    ),
                ],
            )
        ]
    )

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="do several things",
            tools=[
                PROPOSE_CREATE_PROJECT_TOOL,
                PROPOSE_ATTACH_PROJECT_TOOL,
                LIST_PROJECTS_TOOL,
            ],
            pool=object(),
        )
    )

    assert [event.type for event in events] == [
        "project_proposal",
        "attach_proposal",
        "approval_request",
        "done",
    ]


async def test_declining_tells_the_model_not_to_retry(settings, session, project):
    client = FakeClient([attach_call(), answer("Understood, staying here.")])

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="file this under the tracker",
            tools=[PROPOSE_ATTACH_PROJECT_TOOL],
            pool=object(),
        )
    )

    events = await collect(
        resume_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            decisions={"call-1": False},
            tools=[PROPOSE_ATTACH_PROJECT_TOOL],
            pool=object(),
        )
    )

    result = next(event for event in events if event.type == "tool_result")
    assert result.is_error
    assert "denied" in result.content.lower()
    assert events[-1].reason == "end_turn"
