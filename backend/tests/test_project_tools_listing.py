"""The two tools that offer to file a conversation under an existing project."""

from datetime import datetime, timezone

import pytest

from app.agent.tools.attach_tools import (
    PROPOSE_ATTACH_PROJECT_TOOL,
    list_projects,
    propose_attach_project,
)
from app.agent.tools.base import ToolExecutionError
from app.db.project_repo import ProjectSummary

PROJECT = "b5c00fe1-f7c2-463d-b0d1-97006f6ffe0c"


def summary(name: str, project_id: str = PROJECT) -> ProjectSummary:
    return ProjectSummary(
        id=project_id,
        name=name,
        slug=name.lower(),
        updated_at=datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc),
    )


@pytest.fixture
def stub(monkeypatch):
    state = {"projects": [summary("Task-Tracker"), summary("HW", "a7eb1fc5-0000-0000-0000-000000000000")]}
    captured: dict[str, object] = {}

    async def fake_list(pool, *, limit=50):
        captured["limit"] = limit
        return state["projects"]

    monkeypatch.setattr("app.db.project_repo.list_projects", fake_list)
    state["captured"] = captured
    return state


async def test_lists_projects_with_their_ids(stub):
    out = await list_projects(pool=object(), project_id=None, session_id="s")

    assert "Task-Tracker" in out
    assert PROJECT in out, "the model needs the id, not just the name"
    assert "propose_attach_project" in out, "the listing points at the next step"


async def test_says_so_when_there_are_no_projects(stub):
    stub["projects"] = []

    out = await list_projects(pool=object(), project_id=None, session_id="s")

    assert "no projects yet" in out.lower()
    assert "propose_create_project" in out


async def test_listing_refuses_inside_a_project(stub):
    """The conversation is already filed; there is nothing to choose."""
    with pytest.raises(ToolExecutionError, match="already open"):
        await list_projects(pool=object(), project_id=PROJECT, session_id="s")


async def test_listing_degrades_without_a_pool(stub):
    with pytest.raises(ToolExecutionError, match="not available"):
        await list_projects(pool=None, project_id=None, session_id="s")


@pytest.mark.parametrize(("asked", "expected"), [(500, 50), (0, 1), (-3, 1), (10, 10)])
async def test_limit_is_capped(stub, asked, expected):
    await list_projects(limit=asked, pool=object(), project_id=None, session_id="s")
    assert stub["captured"]["limit"] == expected


async def test_the_proposal_body_only_signals(stub):
    """It must never move anything -- _drive parks the call instead."""
    out = propose_attach_project(target_project_id=PROJECT, reason="because")

    assert "do not attempt to move it yourself" in out


def test_the_attach_argument_is_not_named_project_id():
    """_dispatch_tool passes the current project as `project_id` to every tool.

    A parameter of that name would collide with it and the tool could never be
    invoked -- the same trap that forced `chat_id` in chat_tools.py.
    """
    import inspect

    params = inspect.signature(propose_attach_project).parameters
    assert "project_id" not in params
    assert "target_project_id" in params

    properties = PROPOSE_ATTACH_PROJECT_TOOL.input_schema["properties"]
    assert "project_id" not in properties
    assert "target_project_id" in properties


def test_neither_tool_is_in_the_global_registry():
    """Both are global-chat only, like propose_create_project.

    In ALL_TOOLS they would also be offered to workflow nodes and to project
    chats, where neither makes sense.
    """
    from app.agent.tools.registry import TOOLS_BY_NAME

    assert "list_projects" not in TOOLS_BY_NAME
    assert "propose_attach_project" not in TOOLS_BY_NAME
