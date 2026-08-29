"""Container lifecycle for a project.

Four endpoints, all reached from the project UI's status badge:
status / start / stop / remove.

Every one reconciles against the daemon before answering, because
`project_containers` is a cache: `docker rm` or a Docker Desktop restart can
remove a container without anything telling us, and a badge that says "running"
about a container that no longer exists is worse than no badge.

A missing daemon is a 503 with an actionable sentence, not a 500. It is the
expected state on a machine where Docker is not installed, and the rest of the
project keeps working without it -- files come off the host mount, so browsing,
editing and git are unaffected.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.db import container_repo
from app.db.project_repo import get_project
from app.projects.containers import (
    ContainerError,
    ContainerState,
    DockerUnavailableError,
    container_name,
    docker_available,
    ensure_container,
    remove_container,
    status,
    stop_container,
)
from app.projects.workspaces import InvalidProjectIdError, project_workspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["containers"])


class ContainerOut(BaseModel):
    exists: bool
    running: bool
    status: str
    container_id: str | None = None
    container_name: str
    image: str | None = None
    host_port: int | None = None
    #: False when there is no usable daemon. The UI shows "Docker unavailable"
    #: rather than an error, because the project is still usable without it.
    docker_available: bool = True
    message: str | None = None


def _out(project_id: str, state: ContainerState, message: str | None = None):
    return ContainerOut(
        exists=state.exists,
        running=state.running,
        status=state.status,
        container_id=state.container_id,
        container_name=container_name(project_id),
        image=state.image,
        host_port=state.host_port,
        message=message,
    )


def _require_pool(request: Request):
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so projects are unavailable.",
        )
    return pool


async def _require_project(pool, project_id: str):
    try:
        project = await get_project(pool, project_id)
    except Exception as exc:  # noqa: BLE001 - a bad uuid is a 404, not a 500
        raise HTTPException(status_code=404, detail="Project not found.") from exc
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


async def _sync(pool, project_id: str, state: ContainerState, image: str) -> None:
    """Write back what the daemon just told us."""
    await container_repo.record(
        pool,
        project_id,
        container_name=container_name(project_id),
        image=state.image or image,
        status=state.status if state.exists else "removed",
        container_id=state.container_id,
        host_port=state.host_port,
    )


@router.get("/projects/{project_id}/container")
async def container_status(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ContainerOut:
    """What the daemon says right now. Never 503s -- the badge must always render."""
    pool = _require_pool(request)
    await _require_project(pool, project_id)

    if not await docker_available():
        # Deliberately a 200: "Docker is not installed" is a state the UI shows,
        # not a failed request. The project is still fully browsable.
        return ContainerOut(
            exists=False,
            running=False,
            status="unavailable",
            container_name=container_name(project_id),
            docker_available=False,
            message=(
                "Docker is not available, so commands run on the host. Files, "
                "git and the editor are unaffected."
            ),
        )

    state = await status(project_id, container_port=settings.project_container_port)
    await _sync(pool, project_id, state, settings.default_project_image)
    return _out(project_id, state)


@router.post("/projects/{project_id}/container/start")
async def container_start(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ContainerOut:
    """Create-or-start, idempotently. Safe to press twice."""
    pool = _require_pool(request)
    await _require_project(pool, project_id)

    try:
        mount = project_workspace(settings, project_id)
    except InvalidProjectIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        state = await ensure_container(
            project_id,
            mount,
            image=settings.default_project_image,
            container_port=settings.project_container_port,
        )
    except DockerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ContainerError as exc:
        # Record the failure so the badge can explain itself on the next load.
        await container_repo.record(
            pool,
            project_id,
            container_name=container_name(project_id),
            image=settings.default_project_image,
            status="error",
            error=str(exc),
            workspace_path=str(mount),
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await container_repo.record(
        pool,
        project_id,
        container_name=container_name(project_id),
        image=state.image or settings.default_project_image,
        status=state.status,
        container_id=state.container_id,
        host_port=state.host_port,
        workspace_path=str(mount),
    )
    return _out(project_id, state)


@router.post("/projects/{project_id}/container/stop")
async def container_stop(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ContainerOut:
    """Stop but keep the container, so a restart is fast."""
    pool = _require_pool(request)
    await _require_project(pool, project_id)

    try:
        state = await stop_container(project_id)
    except DockerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    await _sync(pool, project_id, state, settings.default_project_image)
    return _out(project_id, state)


@router.post("/projects/{project_id}/container/remove")
async def container_remove(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ContainerOut:
    """Delete the container. The checkout on the host mount is untouched."""
    pool = _require_pool(request)
    await _require_project(pool, project_id)

    try:
        state = await remove_container(project_id)
    except DockerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # The row described a container that no longer exists, so it goes too.
    await container_repo.forget(pool, project_id)
    return _out(project_id, state, message="Container removed. The checkout is intact.")
