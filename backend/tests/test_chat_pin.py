"""Pinning a conversation so it sorts above the rest.

The same offline FakePool recorder test_chat_attach.py uses -- the suite has no
Postgres, and what matters here is the SQL contract: one statement in both
directions, and emphatically no `updated_at` in it.
"""

import inspect

import pytest

from app.db.project_chat_repo import (
    _SUMMARY_SELECT,
    list_sessions,
    list_sessions_by_ids,
    set_session_pinned,
)

from .test_chat_attach import FakePool

SESSION = "sess-abc"


async def test_pinning_sets_a_timestamp():
    pool = FakePool()

    assert await set_session_pinned(pool, SESSION, True) is True

    sql, params = pool.statements[-1]
    assert "update project_chat_sessions" in sql
    assert "pinned_at" in sql
    assert params == (True, SESSION)


async def test_unpinning_clears_it_through_the_same_statement():
    """One `case when`, not two branches: a checkbox should not be able to hit
    different code in each direction."""
    pinned, unpinned = FakePool(), FakePool()

    await set_session_pinned(pinned, SESSION, True)
    await set_session_pinned(unpinned, SESSION, False)

    assert pinned.statements[-1][0] == unpinned.statements[-1][0]
    assert unpinned.statements[-1][1] == (False, SESSION)


async def test_pinning_does_not_touch_updated_at():
    """Pinning is a filing decision, not activity.

    Bumping updated_at would reorder the unpinned list as a side effect of
    tidying the pinned one -- the one thing pinning exists to prevent.
    """
    pool = FakePool()

    await set_session_pinned(pool, SESSION, True)

    assert "updated_at" not in pool.statements[-1][0]


async def test_an_unknown_session_reports_failure():
    pool = FakePool(session_rowcount=0)

    assert await set_session_pinned(pool, SESSION, True) is False


async def test_uses_placeholders_never_interpolation():
    pool = FakePool()

    await set_session_pinned(pool, SESSION, True)

    for sql, _ in pool.statements:
        assert SESSION not in sql


def test_the_listing_puts_pinned_first_with_nulls_last():
    """Postgres defaults DESC to NULLS FIRST.

    Without `nulls last` every UNPINNED chat would float above every pinned
    one -- the feature inverted by one missing keyword.
    """
    source = inspect.getsource(list_sessions)

    assert "pinned_at desc nulls last" in source
    assert source.index("pinned_at desc") < source.index("updated_at desc")


def test_provenance_lookups_ignore_pinning():
    """list_sessions_by_ids answers "what were THESE conversations"."""
    source = inspect.getsource(list_sessions_by_ids)

    assert "pinned_at desc" not in source
    assert "updated_at desc" in source


def test_both_listings_share_one_projection():
    """They were two character-identical copies once; that is the hazard.

    A column added to one and not the other silently gives half the callers a
    stale summary, which is exactly how pinning could have half-shipped.
    """
    assert "pinned_at" in _SUMMARY_SELECT
    for query in (list_sessions, list_sessions_by_ids):
        assert "_SUMMARY_SELECT" in inspect.getsource(query)


@pytest.mark.parametrize("query", [list_sessions, list_sessions_by_ids])
def test_neither_listing_rebuilds_the_projection_by_hand(query):
    source = inspect.getsource(query)

    assert "as title_source" not in source, (
        "projection inlined again; use _SUMMARY_SELECT"
    )
