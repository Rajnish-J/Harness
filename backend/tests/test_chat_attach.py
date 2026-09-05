"""Re-filing a conversation under a project.

The invariant under test is that BOTH chat tables move together. `list_sessions`
reads project_chat_sessions and `load_transcript` reads project_chat_messages,
so a half-applied move leaves the sidebar and the project page permanently
disagreeing about where a conversation lives.

No live Postgres here -- the suite has none -- so the pool is a fake that
records statements. That is enough to pin the three things that matter: both
tables are updated, it happens inside one transaction holding the session's
advisory lock, and a session that does not exist raises before the second write.
"""

import pytest

from app.db.project_chat_repo import SessionNotFoundError, attach_session_to_project

SESSION = "sess-abc"
PROJECT = "33333333-3333-3333-3333-333333333333"


class FakeCursor:
    def __init__(self, recorder, session_rowcount):
        self._recorder = recorder
        self._session_rowcount = session_rowcount
        self.rowcount = 0

    async def execute(self, query, params=None):
        self._recorder.statements.append((" ".join(query.split()), params))
        normalized = query.lower()
        if "update project_chat_sessions" in normalized:
            self.rowcount = self._session_rowcount
        elif "update project_chat_messages" in normalized:
            self.rowcount = 7
        else:
            self.rowcount = 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeTransaction:
    def __init__(self, recorder):
        self._recorder = recorder

    async def __aenter__(self):
        self._recorder.transactions += 1
        return self

    async def __aexit__(self, exc_type, *_):
        if exc_type is not None:
            self._recorder.rolled_back = True
        return False


class FakeConnection:
    def __init__(self, recorder, session_rowcount):
        self._recorder = recorder
        self._session_rowcount = session_rowcount

    def transaction(self):
        return FakeTransaction(self._recorder)

    def cursor(self):
        return FakeCursor(self._recorder, self._session_rowcount)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakePool:
    """Records every statement so the SQL contract can be asserted."""

    def __init__(self, session_rowcount: int = 1) -> None:
        self.statements: list[tuple[str, object]] = []
        self.transactions = 0
        self.rolled_back = False
        self._session_rowcount = session_rowcount

    def connection(self):
        return FakeConnection(self, self._session_rowcount)


async def test_moves_both_tables_in_one_transaction():
    pool = FakePool()

    moved = await attach_session_to_project(pool, SESSION, PROJECT)

    assert moved == 7
    assert pool.transactions == 1

    updated = [sql for sql, _ in pool.statements if sql.startswith("update")]
    assert any("project_chat_sessions" in sql for sql in updated)
    assert any("project_chat_messages" in sql for sql in updated)
    assert len(updated) == 2, "exactly one write per table"


async def test_takes_the_same_advisory_lock_append_messages_uses():
    """Otherwise a turn could INSERT a message between the two UPDATEs."""
    pool = FakePool()

    await attach_session_to_project(pool, SESSION, PROJECT)

    first_sql, first_params = pool.statements[0]
    assert "pg_advisory_xact_lock(hashtext(%s))" in first_sql
    assert first_params == (SESSION,)


async def test_both_updates_carry_the_new_project_id():
    pool = FakePool()

    await attach_session_to_project(pool, SESSION, PROJECT)

    for sql, params in pool.statements:
        if sql.startswith("update"):
            assert params == (PROJECT, SESSION)


async def test_can_re_file_a_conversation_back_to_global():
    """None is a legitimate destination, not a missing argument."""
    pool = FakePool()

    await attach_session_to_project(pool, SESSION, None)

    for sql, params in pool.statements:
        if sql.startswith("update"):
            assert params == (None, SESSION)


async def test_unknown_session_raises_before_touching_messages():
    pool = FakePool(session_rowcount=0)

    with pytest.raises(SessionNotFoundError) as caught:
        await attach_session_to_project(pool, SESSION, PROJECT)

    assert SESSION in str(caught.value)
    assert pool.rolled_back
    assert not any(
        "project_chat_messages" in sql for sql, _ in pool.statements
    ), "the messages UPDATE must not run for a session that does not exist"


async def test_uses_placeholders_never_interpolation():
    """The repo-wide rule: no f-string SQL."""
    pool = FakePool()

    await attach_session_to_project(pool, SESSION, PROJECT)

    for sql, _ in pool.statements:
        assert SESSION not in sql
        assert PROJECT not in sql
