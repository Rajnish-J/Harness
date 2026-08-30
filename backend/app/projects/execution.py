"""Choosing an executor for a project.

The one decision this module makes: when a chat is scoped to a project, do its
shell commands run in that project's container or on the host?

The answer is "the container if one is running, the host otherwise", and the
fallback is deliberate rather than defensive. A project whose container is
stopped -- or a machine with no Docker at all -- should still be usable: the
files are on the host mount either way, so browsing, editing and git all work.
Refusing to run anything would make the absence of a daemon fatal to a feature
that mostly does not need one.

The cost is that a command can run somewhere the operator did not expect, so
`resolve_executor` returns the reason alongside the executor and the callers
surface it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.agent.exec_context import DockerExec, ExecutionContext, LocalExec
from app.core.config import Settings
from app.projects.containers import (
    DockerUnavailableError,
    container_name,
    get_client,
    status,
)
from app.projects.workspaces import project_workspace

logger = logging.getLogger(__name__)


@dataclass
class ResolvedExecutor:
    executor: ExecutionContext
    #: True when commands land in the project's container.
    containerised: bool
    #: One line for the UI explaining where commands will run, and why.
    reason: str


async def resolve_executor(
    settings: Settings, project_id: str | None
) -> ResolvedExecutor:
    """The executor for a chat turn, plus why it is that one."""
    if project_id is None:
        return ResolvedExecutor(
            executor=LocalExec(),
            containerised=False,
            reason="No project attached, so commands run on the host.",
        )

    try:
        state = await status(project_id)
    except DockerUnavailableError as exc:
        logger.info("docker unavailable for project %s: %s", project_id, exc)
        return ResolvedExecutor(
            executor=LocalExec(),
            containerised=False,
            reason=(
                "Docker is not available, so commands run on the host. Start "
                "Docker Desktop to run them inside the project's container."
            ),
        )

    if not state.running or not state.container_id:
        return ResolvedExecutor(
            executor=LocalExec(),
            containerised=False,
            reason=(
                f"The container for this project is not running "
                f"({state.status}), so commands run on the host."
            ),
        )

    client = await get_client()
    mount: Path = project_workspace(settings, project_id)
    return ResolvedExecutor(
        executor=DockerExec(client, state.container_id, mount),
        containerised=True,
        reason=f"Commands run inside {container_name(project_id)}.",
    )
