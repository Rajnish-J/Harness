"""Wire contract for the memory admin API (/api/memory).

Mirrors the split documented in app/models/chat.py: these are the shapes
crossing the HTTP boundary; app/db/memory_repo.py's MemoryRow dataclass is the
DB-row shape, mapped into MemoryOut by app/api/memory.py.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.db.memory_repo import MemoryRow

#: Kept in sync by hand with memory_repo.VALID_KINDS and the `memory_kind`
#: Postgres enum in frontend/db/schema.ts -- the same duplication this
#: codebase already accepts between chat_role and TranscriptEntry.role.
MemoryKind = Literal["preference", "feedback", "fact", "reference"]


class MemoryOut(BaseModel):
    id: str
    project_id: str | None
    kind: str
    slug: str
    title: str
    content: str
    source: str
    session_id: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: MemoryRow) -> "MemoryOut":
        return cls(
            id=str(row.id),
            project_id=str(row.project_id) if row.project_id else None,
            kind=row.kind,
            slug=row.slug,
            title=row.title,
            content=row.content,
            source=row.source,
            session_id=row.session_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class MemorySessionOut(BaseModel):
    """The conversation a memory came from, resolved to something readable.

    Only sessions that actually produced a memory are ever returned. A
    memory's `session_id` can dangle — `clear_session` hard-deletes chat rows
    while the memory keeps the id — so an id with no entry here means "that
    conversation is gone", not "lookup failed".
    """

    session_id: str
    title: str
    updated_at: datetime
    message_count: int


class MemoryOverviewOut(BaseModel):
    """Every active memory in every scope, plus the sessions behind them.

    Deliberately two flat lists rather than memories with sessions nested:
    several memories usually share one session, and the caller joins on
    `session_id` once instead of receiving the same conversation repeatedly.
    Project names are NOT resolved here — the frontend already lists projects
    from Next.js, which also gives it the projects that have no memories yet.
    """

    memories: list[MemoryOut]
    sessions: list[MemorySessionOut]


class MemoryPreviewOut(BaseModel):
    """The `<memories>` block a turn in one scope would actually receive.

    Rendered by the same `compose_system_prompt` the agent loop uses, so this
    cannot drift from the real thing — a preview that disagrees with the
    prompt would be worse than no preview at all.
    """

    project_id: str | None
    #: Empty string when nothing is in scope — there is no block at all then.
    block: str
    char_count: int
    memory_count: int
    #: The ceiling the block shares with the base prompt, agent prompt and
    #: skills. Memories compose last, so they truncate first.
    max_system_prompt_chars: int


class MemoryCreate(BaseModel):
    """A human creating a memory by hand from the /memory admin page."""

    project_id: str | None = Field(default=None, max_length=64)
    kind: MemoryKind = "fact"
    #: Blank derives one from the title, same as the `remember` tool does.
    slug: str = Field(default="", max_length=80)
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20_000)


class MemoryUpdate(BaseModel):
    """Partial edit -- only the given fields change."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=20_000)
    kind: MemoryKind | None = None
