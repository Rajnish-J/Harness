"""The three memory tiers: who each row reaches, and how it is keyed.

No test database in this suite (see test_memory_tools.py), so these assert on
the SQL and parameters the repo generates. That is weaker than running it, and
deliberately paired with the predicates in frontend/db/schema.ts: Postgres
infers an ON CONFLICT target by matching it against an index's own WHERE
clause, so the two have to be read together and a drift between them is a hard
runtime error on every write rather than a silent fallback.
"""

from dataclasses import dataclass
from typing import Any

import pytest

from app.db import memory_repo

SESSION = "sess-abc"
PROJECT = "6f1b2c9e-0000-4a11-9f2c-abc123456789"


@dataclass
class _Recorder:
    """Captures the one statement the repo runs, standing in for a pool."""

    sql: str = ""
    params: tuple[Any, ...] = ()

    # -- async context manager protocol, for `async with pool.connection()` --
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    def connection(self):
        return self

    def cursor(self):
        return self

    async def execute(self, sql, params=None):
        self.sql = " ".join(sql.split())
        self.params = params or ()

    async def fetchall(self):
        return []

    async def fetchone(self):
        return None


@pytest.fixture
def rec() -> _Recorder:
    return _Recorder()


# --------------------------------------------------------------- list_active


async def test_a_turn_with_no_session_asks_for_the_old_two_tiers(rec):
    """Every caller that predates the tier keeps its exact previous answer.

    `scoped_session_id = NULL` is NULL, never true, so the conversation
    disjunct contributes nothing when no session is given -- which is why the
    parameter could be added without touching the admin endpoints.
    """
    await memory_repo.list_active(rec, PROJECT)

    assert rec.params == (PROJECT, None)
    assert "scoped_session_id is null" in rec.sql
    assert "project_id is null or project_id = %s" in rec.sql


async def test_the_global_and_project_tiers_exclude_conversation_rows(rec):
    """Without this the tier would leak into every chat, which is the exact
    opposite of what it is for."""
    await memory_repo.list_active(rec, PROJECT, SESSION)

    # The first disjunct -- the two broad tiers -- is gated on the new column.
    assert "(scoped_session_id is null and (project_id is null or project_id = %s))" in rec.sql


async def test_a_turn_in_a_session_also_asks_for_that_conversations_rows(rec):
    await memory_repo.list_active(rec, PROJECT, SESSION)

    assert rec.params == (PROJECT, SESSION)
    assert "scoped_session_id is not null and scoped_session_id = %s" in rec.sql


async def test_the_order_is_stable_so_the_prompt_prefix_stays_cacheable(rec):
    await memory_repo.list_active(rec, PROJECT, SESSION)
    assert "order by kind, slug" in rec.sql


# --------------------------------------------------------------- get_by_slug


async def test_get_by_slug_matches_nulls_on_both_scope_columns(rec):
    """NULL is a value that carries meaning on both, so `=` would find nothing
    exactly when it matters."""
    await memory_repo.get_by_slug(rec, None, "a-slug")

    assert "project_id is not distinct from %s" in rec.sql
    assert "scoped_session_id is not distinct from %s" in rec.sql
    assert rec.params == (None, None, "a-slug")


async def test_get_by_slug_addresses_a_conversation_row(rec):
    await memory_repo.get_by_slug(rec, PROJECT, "a-slug", SESSION)
    assert rec.params == (PROJECT, SESSION, "a-slug")


# -------------------------------------------------------------------- upsert
#
# One test per tier. These predicates must match the three partial unique
# indexes in schema.ts character for character.


@pytest.mark.parametrize(
    ("project_id", "scoped_session_id", "expected"),
    [
        (
            None,
            None,
            "on conflict (slug) where project_id is null and scoped_session_id is null",
        ),
        (
            PROJECT,
            None,
            "on conflict (project_id, slug) "
            "where project_id is not null and scoped_session_id is null",
        ),
        (
            PROJECT,
            SESSION,
            "on conflict (scoped_session_id, slug) where scoped_session_id is not null",
        ),
    ],
    ids=["global", "project", "conversation"],
)
async def test_each_tier_targets_its_own_partial_index(
    rec, monkeypatch, project_id, scoped_session_id, expected
):
    async def fake_get_by_slug(*_args, **_kwargs):
        return object()  # upsert only asserts it is not None

    monkeypatch.setattr(memory_repo, "get_by_slug", fake_get_by_slug)

    await memory_repo.upsert(
        rec,
        project_id=project_id,
        kind="fact",
        slug="a-slug",
        title="A fact",
        content="Something true.",
        session_id="writer-session",
        scoped_session_id=scoped_session_id,
    )

    assert expected in rec.sql


async def test_a_conversation_row_still_records_its_project_and_provenance(
    rec, monkeypatch
):
    """scoped_session_id alone decides the tier. project_id rides along for
    grouping on /memory-insights, and session_id stays provenance."""

    async def fake_get_by_slug(*_args, **_kwargs):
        return object()

    monkeypatch.setattr(memory_repo, "get_by_slug", fake_get_by_slug)

    await memory_repo.upsert(
        rec,
        project_id=PROJECT,
        kind="fact",
        slug="a-slug",
        title="A fact",
        content="Something true.",
        session_id="writer-session",
        scoped_session_id=SESSION,
    )

    assert rec.params[0] == PROJECT
    assert "writer-session" in rec.params
    assert SESSION in rec.params
