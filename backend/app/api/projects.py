"""Repository discovery, cloning, and blank-project setup.

Reached only from the Projects UI:

- ``GET  /api/projects/github/repos``     — what can this credential see?
- ``POST /api/projects/{id}/clone``       — clone a repo into it, streaming progress.
- ``POST /api/projects/{id}/init``        — set up a Blank Project's working tree.
- ``POST /api/projects/{id}/connect``     — point a Blank Project at a GitHub
  remote and push its history to it.

The clone streams SSE for the same reason chat does: it takes tens of seconds,
and a spinner that cannot say *which* of clone / index / finish is happening is
much worse than one that can. It reuses the frame format the frontend's
`consumeSSE` already parses, so no new client plumbing is needed. `init` and
`connect` are local and typically instant by comparison, so they answer once
rather than streaming.

Progress is reported as discrete named steps rather than parsed out of git's
stdout. git writes progress to a TTY it does not have here, and scraping
percentages out of `Receiving objects:` would break the first time git changed
its wording.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.sse import SSE_HEADERS
from app.core.config import Settings, get_settings
from app.core.secrets import CredentialCryptoError
from app.db.credential_repo import get_enabled_credential
from app.db.project_repo import (
    get_project,
    mark_clone_failed,
    mark_clone_started,
    mark_clone_succeeded,
    replace_project_files,
)
from app.integrations.github import GitHubError, list_repos
from app.models.events import AgentEvent, sse_comment
from app.projects.devcontainer import ensure_devcontainer
from app.projects.git_ops import (
    GitOperationError,
    clone,
    commit_all,
    current_branch,
    init_repo,
    push,
    set_remote,
)
from app.projects.indexer import index_repository
from app.projects.workspaces import (
    InvalidProjectIdError,
    project_workspace,
    remove_project_workspace,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["projects"])


class CloneProgressEvent(AgentEvent):
    type: Literal["clone_progress"] = "clone_progress"
    step: str
    message: str


class CloneDoneEvent(AgentEvent):
    type: Literal["clone_done"] = "clone_done"
    reason: str
    branch: str | None = None
    file_count: int = 0


class CloneErrorEvent(AgentEvent):
    type: Literal["clone_error"] = "clone_error"
    message: str


class RepoOut(BaseModel):
    id: str
    name: str
    full_name: str
    owner: str
    clone_url: str
    default_branch: str
    private: bool
    description: str | None = None
    updated_at: str | None = None


def _require_pool(request: Request):
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so projects are unavailable.",
        )
    return pool


async def _token_for(pool, credential_id: str, settings: Settings) -> str:
    """Decrypt the token for a credential, or raise the right HTTP error."""
    credential = await get_enabled_credential(pool, credential_id)
    if credential is None:
        raise HTTPException(
            status_code=404,
            detail="Credential not found, or it is disabled.",
        )
    try:
        return credential.decrypt(settings)
    except CredentialCryptoError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/projects/github/repos")
async def github_repos(
    request: Request,
    credential_id: str = Query(..., description="Which stored credential to use."),
    page: int = Query(1, ge=1),
    search: str = Query("", description="Case-insensitive filter on full name."),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Repositories the given credential can see."""
    pool = _require_pool(request)
    token = await _token_for(pool, credential_id, settings)

    try:
        repos = await list_repos(token, page=page)
    except GitHubError as exc:
        # 502: GitHub said no, which is not this server malfunctioning.
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        del token

    needle = search.strip().lower()
    if needle:
        repos = [r for r in repos if needle in r.full_name.lower()]

    return {
        "repos": [RepoOut(**vars(repo)).model_dump() for repo in repos],
        "page": page,
    }


@router.post("/projects/{project_id}/clone")
async def clone_project(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Clone a project's repository, streaming progress."""
    pool = _require_pool(request)
    return StreamingResponse(
        _clone_stream(pool, project_id, settings),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def _clone_stream(
    pool, project_id: str, settings: Settings
) -> AsyncIterator[str]:
    # Flushes proxies that would otherwise sit on the first frame.
    yield sse_comment("stream open")

    project = await get_project(pool, project_id)
    if project is None:
        yield CloneErrorEvent(message="Project not found.").to_sse()
        yield CloneDoneEvent(reason="error").to_sse()
        return

    try:
        destination = project_workspace(settings, project_id)
    except InvalidProjectIdError as exc:
        yield CloneErrorEvent(message=str(exc)).to_sse()
        yield CloneDoneEvent(reason="error").to_sse()
        return

    token: str | None = None
    if project.credential_id:
        try:
            token = await _token_for(pool, str(project.credential_id), settings)
        except HTTPException as exc:
            yield CloneErrorEvent(message=str(exc.detail)).to_sse()
            yield CloneDoneEvent(reason="error").to_sse()
            return

    await mark_clone_started(pool, project_id)

    try:
        yield CloneProgressEvent(
            step="clone", message=f"Cloning {project.repo_owner}/{project.repo_name}…"
        ).to_sse()

        await clone(
            project.repo_url,
            destination,
            token=token,
            branch=project.default_branch or None,
        )

        try:
            ensure_devcontainer(
                destination,
                project_name=project.name,
                default_image=settings.default_project_image,
            )
        except OSError:
            # A local VS Code convenience file, not required for anything
            # downstream -- the clone has already succeeded.
            logger.exception(
                "could not write devcontainer scaffold for %s", project_id
            )

        yield CloneProgressEvent(
            step="index", message="Indexing the working tree…"
        ).to_sse()

        files = await index_repository(
            destination, max_file_bytes=settings.max_file_bytes
        )
        count = await replace_project_files(pool, project_id, files)

        branch = await current_branch(destination)
        await mark_clone_succeeded(pool, project_id, branch=branch)

        yield CloneProgressEvent(
            step="done", message=f"Indexed {count} files on {branch or 'HEAD'}."
        ).to_sse()
        yield CloneDoneEvent(reason="ok", branch=branch, file_count=count).to_sse()

    except (GitOperationError, OSError) as exc:
        message = str(exc)
        logger.warning("clone failed for project %s: %s", project_id, message)
        await mark_clone_failed(pool, project_id, error=message)
        # A partial checkout looks like a working one to everything downstream,
        # so it goes rather than being left for a confusing retry.
        try:
            remove_project_workspace(settings, project_id)
        except OSError:
            logger.exception("could not clean up failed clone %s", project_id)
        yield CloneErrorEvent(message=message).to_sse()
        yield CloneDoneEvent(reason="error").to_sse()

    finally:
        del token


class InitResult(BaseModel):
    branch: str | None = None
    file_count: int = 0


@router.post("/projects/{project_id}/init")
async def init_project(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> InitResult:
    """Set up a Blank Project's working tree: `git init`, a README, one commit.

    Reuses the clone-status columns rather than adding new ones — a Blank
    Project has no remote, but "has this project's working tree been set up
    yet" is the same question `clone_status` already answers for a cloned one.
    """
    pool = _require_pool(request)
    project = await get_project(pool, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        destination = project_workspace(settings, project_id)
    except InvalidProjectIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await mark_clone_started(pool, project_id)

    try:
        await init_repo(destination, branch=project.default_branch or "main")
        (destination / "README.md").write_text(
            f"# {project.name}\n", encoding="utf-8", newline=""
        )
        ensure_devcontainer(
            destination,
            project_name=project.name,
            default_image=settings.default_project_image,
        )
        await commit_all(destination, "Initial commit")

        files = await index_repository(
            destination, max_file_bytes=settings.max_file_bytes
        )
        count = await replace_project_files(pool, project_id, files)

        branch = await current_branch(destination)
        await mark_clone_succeeded(pool, project_id, branch=branch)
        return InitResult(branch=branch, file_count=count)

    except (GitOperationError, OSError) as exc:
        message = str(exc)
        logger.warning("init failed for project %s: %s", project_id, message)
        await mark_clone_failed(pool, project_id, error=message)
        try:
            remove_project_workspace(settings, project_id)
        except OSError:
            logger.exception("could not clean up failed init %s", project_id)
        raise HTTPException(status_code=500, detail=message) from exc


class ConnectResult(BaseModel):
    branch: str | None = None


@router.post("/projects/{project_id}/connect")
async def connect_project(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ConnectResult:
    """Point a Blank Project's working tree at its newly-linked GitHub remote
    and push everything to it.

    The remote coordinates (`repo_url`, `credential_id`, ...) are written by
    the Next.js side first — this only runs once the project row already
    names a repository to push to. There is deliberately no `git init` here:
    if the working tree is not already set up, `/init` was skipped or failed,
    and connecting to a remote would not fix that.
    """
    pool = _require_pool(request)
    project = await get_project(pool, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    if not project.repo_url:
        raise HTTPException(
            status_code=400,
            detail="This project has no repository linked yet.",
        )

    destination = project_workspace(settings, project_id)
    if not (destination / ".git").is_dir():
        raise HTTPException(
            status_code=409, detail="This project's working tree is not set up yet."
        )

    token: str | None = None
    if project.credential_id:
        token = await _token_for(pool, str(project.credential_id), settings)

    try:
        await set_remote(destination, project.repo_url)
        branch = await current_branch(destination) or project.default_branch
        await push(destination, branch, token=token)
        await mark_clone_succeeded(pool, project_id, branch=branch)
        return ConnectResult(branch=branch)
    except GitOperationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        del token
