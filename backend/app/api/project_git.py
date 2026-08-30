"""Branch, commit, push, and pull requests.

Every endpoint here is a destructive or outward-facing action, and none of them
is reachable by the model. `app/agent/tools/git_tools.py` deliberately gives the
agent a read-mostly git surface; these are the verbs it withholds, exposed only
behind a button a person pressed. The agent can propose a change and commit it
locally -- a human decides whether it leaves the machine.

That boundary is the whole point of the split, so nothing in this module should
ever be added to `ALL_TOOLS`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.secrets import CredentialCryptoError
from app.db.credential_repo import get_enabled_credential
from app.db.project_repo import ProjectRow, get_project
from app.integrations.github import (
    GitHubError,
    create_pull_request,
    list_pull_requests,
    merge_pull_request,
)
from app.projects.git_ops import (
    GitOperationError,
    commit_all,
    create_branch,
    current_branch,
    list_branches,
    push,
    working_tree_dirty,
)
from app.projects.workspaces import InvalidProjectIdError, project_workspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["project-git"])


class BranchRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    base: str | None = None


class CommitRequest(BaseModel):
    message: str = Field(..., min_length=1)
    push_after: bool = True


class PullRequestBody(BaseModel):
    title: str = Field(..., min_length=1)
    body: str = ""
    base: str | None = None
    draft: bool = False


class MergeRequest(BaseModel):
    method: str = "merge"


class GitStatusOut(BaseModel):
    current_branch: str | None
    branches: list[str]
    dirty: bool


def _require_pool(request: Request):
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so projects are unavailable.",
        )
    return pool


async def _project(pool, project_id: str) -> ProjectRow:
    project = await get_project(pool, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _repo_path(settings: Settings, project_id: str):
    try:
        return project_workspace(settings, project_id)
    except InvalidProjectIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _token(pool, project: ProjectRow, settings: Settings) -> str:
    """The decrypted token for a project, or a 400 explaining what is missing."""
    if not project.credential_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "This project has no credential linked, so it cannot talk to "
                "GitHub. Link one on the Credentials page."
            ),
        )
    credential = await get_enabled_credential(pool, str(project.credential_id))
    if credential is None:
        raise HTTPException(
            status_code=400,
            detail="The project's credential is missing or disabled.",
        )
    try:
        return credential.decrypt(settings)
    except CredentialCryptoError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/projects/{project_id}/git")
async def git_status(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> GitStatusOut:
    """Branches and whether there is anything uncommitted."""
    pool = _require_pool(request)
    await _project(pool, project_id)
    repo = _repo_path(settings, project_id)

    if not (repo / ".git").is_dir():
        raise HTTPException(status_code=409, detail="This project is not cloned yet.")

    try:
        return GitStatusOut(
            current_branch=await current_branch(repo),
            branches=await list_branches(repo),
            dirty=await working_tree_dirty(repo),
        )
    except GitOperationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/projects/{project_id}/branches")
async def new_branch(
    project_id: str,
    body: BranchRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> GitStatusOut:
    pool = _require_pool(request)
    await _project(pool, project_id)
    repo = _repo_path(settings, project_id)

    try:
        await create_branch(repo, body.name.strip(), base=body.base)
    except GitOperationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return GitStatusOut(
        current_branch=await current_branch(repo),
        branches=await list_branches(repo),
        dirty=await working_tree_dirty(repo),
    )


@router.post("/projects/{project_id}/commit")
async def commit(
    project_id: str,
    body: CommitRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Commit everything, and push unless asked not to."""
    pool = _require_pool(request)
    project = await _project(pool, project_id)
    repo = _repo_path(settings, project_id)

    try:
        result = await commit_all(repo, body.message)
    except GitOperationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    branch = await current_branch(repo)
    pushed = False

    if body.push_after:
        try:
            token = await _token(pool, project, settings)
        except HTTPException as exc:
            # The commit already happened -- say so, or the operator re-runs
            # it looking for work that already landed.
            raise HTTPException(
                status_code=exc.status_code,
                detail=f"Committed locally, but not pushed: {exc.detail}",
            ) from exc
        try:
            await push(repo, branch or project.default_branch, token=token)
            pushed = True
        except GitOperationError as exc:
            # The commit succeeded and is not lost; only the push failed. Say
            # exactly that, so nobody re-runs the commit looking for it.
            raise HTTPException(
                status_code=502,
                detail=f"Committed locally, but the push failed.\n\n{exc}",
            ) from exc
        finally:
            del token

    return {"committed": True, "pushed": pushed, "branch": branch, "output": result.output}


@router.get("/projects/{project_id}/pulls")
async def get_pulls(
    project_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    pool = _require_pool(request)
    project = await _project(pool, project_id)
    token = await _token(pool, project, settings)

    try:
        pulls = await list_pull_requests(token, project.repo_owner, project.repo_name)
    except GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        del token

    return {"pulls": [vars(p) for p in pulls]}


@router.post("/projects/{project_id}/pulls")
async def open_pull(
    project_id: str,
    body: PullRequestBody,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    pool = _require_pool(request)
    project = await _project(pool, project_id)
    repo = _repo_path(settings, project_id)

    head = await current_branch(repo)
    base = body.base or project.default_branch
    if head == base:
        raise HTTPException(
            status_code=400,
            detail=(
                f"You are on {base}, which is the target branch. Create a branch "
                "before opening a pull request."
            ),
        )

    token = await _token(pool, project, settings)
    try:
        pull = await create_pull_request(
            token,
            project.repo_owner,
            project.repo_name,
            title=body.title,
            head=head or "",
            base=base,
            body=body.body,
            draft=body.draft,
        )
    except GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        del token

    return vars(pull)


@router.post("/projects/{project_id}/pulls/{number}/merge")
async def merge_pull(
    project_id: str,
    number: int,
    body: MergeRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Merge a pull request.

    POST rather than PUT only because the CORS policy in main.py allows GET and
    POST; the underlying GitHub call is a PUT. The UI confirms before calling
    this -- it is the one action here that changes a shared branch.
    """
    pool = _require_pool(request)
    project = await _project(pool, project_id)
    token = await _token(pool, project, settings)

    try:
        sha = await merge_pull_request(
            token,
            project.repo_owner,
            project.repo_name,
            number,
            method=body.method,
        )
    except GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        del token

    return {"merged": True, "sha": sha}
