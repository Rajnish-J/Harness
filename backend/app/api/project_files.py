"""Reading and writing a project's files.

These deliberately touch the HOST filesystem rather than going through
`docker exec`. The container bind-mounts the same directory, so reading a file
through the daemon would be slower, would lose `resolve_safe_path`'s guarantees,
and would buy nothing. The useful consequence is that the editor works with the
container stopped, or with no Docker installed at all -- only running commands
needs one.

Every path goes through `settings_for_project` and then `resolve_safe_path`, so
the sandbox guard is the same single function the agent's file tools use. There
is no second implementation of the containment check here.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.workspace import WorkspaceSecurityError, resolve_safe_path
from app.db import project_chat_repo
from app.db.project_repo import get_project, replace_project_files
from app.projects.indexer import index_repository
from app.projects.workspaces import InvalidProjectIdError, project_workspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["project-files"])


class FileNode(BaseModel):
    path: str
    name: str
    dir_path: str
    is_binary: bool
    size_bytes: int


class FileContent(BaseModel):
    path: str
    content: str
    size_bytes: int
    truncated: bool = False


class WriteFileRequest(BaseModel):
    path: str = Field(..., min_length=1)
    content: str


def _require_pool(request: Request):
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so projects are unavailable.",
        )
    return pool


def _workspace(settings: Settings, project_id: str) -> Path:
    try:
        return project_workspace(settings, project_id)
    except InvalidProjectIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _safe(path: str, root: Path) -> Path:
    """The one guardrail, reused. A rejection is a 400, not a 500."""
    try:
        return resolve_safe_path(path, root)
    except WorkspaceSecurityError as exc:
        # The agent sees these as tool errors; a UI request sees a 400. Either
        # way the check itself is identical.
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}/tree")
async def project_tree(
    project_id: str,
    request: Request,
    dir_path: str = Query("", description="Parent directory, '' for the root."),
) -> dict[str, object]:
    """One level of the file tree, straight from the index.

    Served from `project_files` rather than a filesystem walk -- that is what
    the index was built for. Walking a 5,000-file repo on every expand would
    make the tree feel slow for no reason.
    """
    pool = _require_pool(request)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                select path, name, dir_path, is_binary, size_bytes
                from project_files
                where project_id = %s and dir_path = %s
                order by name
                """,
                (project_id, dir_path),
            )
            files = await cur.fetchall()

            # Immediate child directories, derived from the paths themselves --
            # there is no directory row to select, because a directory is not a
            # file and the index only holds files.
            prefix = f"{dir_path}/" if dir_path else ""
            await cur.execute(
                """
                select distinct dir_path from project_files
                where project_id = %s and dir_path like %s and dir_path <> %s
                """,
                (project_id, f"{prefix}%", dir_path),
            )
            descendants = [r["dir_path"] for r in await cur.fetchall()]

    depth = len(prefix)
    children = sorted(
        {d[depth:].split("/", 1)[0] for d in descendants if d.startswith(prefix)}
    )

    return {
        "dir_path": dir_path,
        "directories": [{"name": name, "path": prefix + name} for name in children],
        "files": [FileNode(**dict(row)).model_dump() for row in files],
    }


@router.get("/projects/{project_id}/file")
async def read_project_file(
    project_id: str,
    request: Request,
    path: str = Query(..., min_length=1),
    settings: Settings = Depends(get_settings),
) -> FileContent:
    """One file's text, for the editor."""
    pool = _require_pool(request)
    if await get_project(pool, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    target = _safe(path, _workspace(settings, project_id))
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"No such file: {path}")

    size = target.stat().st_size
    if size > settings.max_file_bytes:
        # Refused rather than truncated: half a source file in an editor that
        # can save is a good way to destroy the other half.
        raise HTTPException(
            status_code=413,
            detail=(
                f"{path} is {size} bytes, over the {settings.max_file_bytes} byte "
                "limit. It can be edited with the agent's tools but not opened here."
            ),
        )

    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=415, detail=f"{path} is not UTF-8 text."
        ) from exc

    return FileContent(path=path, content=content, size_bytes=size)


@router.post("/projects/{project_id}/file")
async def write_project_file(
    project_id: str,
    body: WriteFileRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> FileContent:
    """Save a file, then refresh the index for the whole project.

    Re-indexing everything rather than the one row is deliberate: a save can
    change what git tracks (a new file, a rename landing), and `git ls-files` is
    fast enough that being correct beats being clever here.
    """
    pool = _require_pool(request)
    if await get_project(pool, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    root = _workspace(settings, project_id)
    target = _safe(body.path, root)
    if target.exists() and target.is_dir():
        raise HTTPException(status_code=400, detail=f"{body.path} is a directory.")

    target.parent.mkdir(parents=True, exist_ok=True)
    # newline="" so the file keeps exactly the line endings it was sent with,
    # rather than Windows silently rewriting every \n on the way to disk.
    target.write_text(body.content, encoding="utf-8", newline="")

    try:
        files = await index_repository(root, max_file_bytes=settings.max_file_bytes)
        await replace_project_files(pool, project_id, files)
    except Exception:  # noqa: BLE001 - the save succeeded; the index can lag
        logger.exception("re-index failed after writing %s", body.path)

    return FileContent(
        path=body.path,
        content=body.content,
        size_bytes=target.stat().st_size,
    )


@router.get("/projects/{project_id}/chat/history")
async def chat_history(project_id: str, request: Request) -> dict[str, object]:
    """The saved transcript, so a returning project repaints what it had.

    Read-only and read-once: the page seeds its provider with this on mount and
    the live stream takes over from there.

    One conversation, not the project's. A project can hold several chats, and
    returning every session's messages ordered by time interleaved them into a
    transcript that never happened. The newest session is the one the browser's
    localStorage almost certainly still points at, and it is the only answer the
    server can give without being told which id the client holds.
    """
    pool = _require_pool(request)
    if await get_project(pool, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    recent = await project_chat_repo.list_sessions(pool, project_id, limit=1)
    if not recent:
        return {"messages": []}

    rows = await project_chat_repo.load_transcript_for_session(
        pool, recent[0].session_id
    )
    return {"messages": rows}
