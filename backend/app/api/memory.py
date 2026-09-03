"""Manual admin surface for cross-session memory.

The automatic write path is the `remember` tool
(app/agent/tools/memory_tools.py), called by the agent mid-turn. This router
is the human path: the /memory admin page in the frontend talks to these
routes directly, the same way the chat UI talks to /api/chat, rather than
through a Next.js/Drizzle route -- `memory_entries` has exactly one writer
(this backend), matching the ownership rule in frontend/db/schema.ts.

503s rather than 500s when DATABASE_URL is unset, same as credentials.py and
workflows.py: that is an operator configuration problem with a specific fix,
not a server fault.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.agent.loop import SYSTEM_PROMPT
from app.agent.prompt import compose_system_prompt
from app.core.config import Settings, get_settings
from app.db import memory_repo, project_chat_repo
from app.models.memory import (
    MemoryCreate,
    MemoryOut,
    MemoryOverviewOut,
    MemoryPreviewOut,
    MemorySessionOut,
    MemoryUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/memory", tags=["memory"])


def _require_pool(request: Request):
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so memory cannot be read or written.",
        )
    return pool


@router.get("")
async def list_memory(request: Request, project_id: str | None = None) -> list[MemoryOut]:
    """Active memory in scope: global rows, plus `project_id`'s if given."""
    pool = _require_pool(request)
    rows = await memory_repo.list_active(pool, project_id)
    return [MemoryOut.from_row(row) for row in rows]


@router.get("/overview")
async def memory_overview(request: Request) -> MemoryOverviewOut:
    """Every active memory in every scope, plus the conversations behind them.

    Declared before the `/{memory_id}` routes so a literal path can never be
    read as an id. The session lookup is keyed off exactly the ids the
    memories carry, so a harness with no agent-written memories makes no
    second query at all.
    """
    pool = _require_pool(request)
    rows = await memory_repo.list_all(pool)

    session_ids = sorted({row.session_id for row in rows if row.session_id})
    sessions = await project_chat_repo.list_sessions_by_ids(pool, session_ids)

    return MemoryOverviewOut(
        memories=[MemoryOut.from_row(row) for row in rows],
        sessions=[
            MemorySessionOut(
                session_id=summary.session_id,
                title=summary.title,
                updated_at=summary.updated_at,
                message_count=summary.message_count,
            )
            for summary in sessions
        ],
    )


@router.get("/preview")
async def memory_preview(
    request: Request,
    project_id: str | None = None,
    settings: Settings = Depends(get_settings),
) -> MemoryPreviewOut:
    """The `<memories>` block a turn in this scope would receive, verbatim.

    Composed by the same `compose_system_prompt` the agent loop calls, then
    sliced from its marker — memories are the last section, so slicing to the
    end yields exactly the block and nothing else.

    Composed WITHOUT an agent preset or skills, and without the char ceiling:
    what a real turn carries alongside memory varies per preset, so applying
    one preset's budget here would show a truncation that another preset would
    not hit. `max_system_prompt_chars` is reported instead, as the ceiling all
    of it shares.
    """
    pool = _require_pool(request)
    rows = await memory_repo.list_active(pool, project_id)

    composed = compose_system_prompt(base=SYSTEM_PROMPT, memories=rows)
    marker = composed.find("<memories>")
    block = composed[marker:] if marker != -1 else ""

    return MemoryPreviewOut(
        project_id=project_id,
        block=block,
        char_count=len(block),
        memory_count=len(rows),
        max_system_prompt_chars=settings.max_system_prompt_chars,
    )


@router.post("")
async def create_memory(payload: MemoryCreate, request: Request) -> MemoryOut:
    """A human adding a memory by hand, same upsert-by-slug as the agent's
    `remember` tool -- re-using an existing slug edits that memory."""
    pool = _require_pool(request)
    row = await memory_repo.upsert(
        pool,
        project_id=payload.project_id,
        kind=payload.kind,
        slug=payload.slug.strip() or memory_repo.slugify(payload.title),
        title=payload.title,
        content=payload.content,
        source="human",
    )
    return MemoryOut.from_row(row)


@router.patch("/{memory_id}")
async def update_memory(
    memory_id: str, payload: MemoryUpdate, request: Request
) -> MemoryOut:
    pool = _require_pool(request)
    row = await memory_repo.update(
        pool,
        memory_id,
        title=payload.title,
        content=payload.content,
        kind=payload.kind,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Memory not found.")
    return MemoryOut.from_row(row)


@router.delete("/{memory_id}")
async def delete_memory(memory_id: str, request: Request) -> dict[str, bool]:
    """Archives rather than deletes -- same soft-delete discipline as projects."""
    pool = _require_pool(request)
    archived = await memory_repo.archive(pool, memory_id)
    if not archived:
        raise HTTPException(status_code=404, detail="Memory not found.")
    return {"ok": True}
