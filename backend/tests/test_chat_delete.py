"""Deleting a conversation for good.

The same offline recorder the attach and pin suites use -- there is no Postgres
here, and what matters is the SQL contract: both tables in one transaction,
messages before the session, and the SESSION rowcount deciding whether the route
404s.
"""

from app.db.project_chat_repo import clear_session

from .test_chat_attach import FakeCursor, FakePool

SESSION = "sess-abc"


class DeleteCursor(FakeCursor):
    """FakeCursor only classifies `update`s; deletes need their own rowcounts.

    Split per table on purpose: the two are what
    test_a_session_with_no_messages_still_deletes pulls apart.
    """

    def __init__(self, recorder, session_rowcount, message_rowcount=4):
        super().__init__(recorder, session_rowcount)
        self._message_rowcount = message_rowcount

    async def execute(self, query, params=None):
        await super().execute(query, params)
        normalized = query.lower()
        if "delete from project_chat_sessions" in normalized:
            self.rowcount = self._session_rowcount
        elif "delete from project_chat_messages" in normalized:
            self.rowcount = self._message_rowcount


class DeletePool(FakePool):
    def __init__(self, session_rowcount: int = 1, message_rowcount: int = 4) -> None:
        super().__init__(session_rowcount)
        self._message_rowcount = message_rowcount

    def connection(self):
        connection = super().connection()
        connection.cursor = lambda: DeleteCursor(
            self, self._session_rowcount, self._message_rowcount
        )
        return connection


async def test_deletes_both_tables_in_one_transaction():
    pool = DeletePool()

    assert await clear_session(pool, SESSION) is True
    assert pool.transactions == 1

    deleted = [sql for sql, _ in pool.statements if sql.startswith("delete")]
    assert len(deleted) == 2, "exactly one delete per table"
    assert any("project_chat_messages" in sql for sql in deleted)
    assert any("project_chat_sessions" in sql for sql in deleted)


async def test_messages_go_before_the_session():
    """The reverse order orphans messages pointing at a session already gone."""
    pool = DeletePool()

    await clear_session(pool, SESSION)

    deleted = [sql for sql, _ in pool.statements if sql.startswith("delete")]
    assert "project_chat_messages" in deleted[0]
    assert "project_chat_sessions" in deleted[1]


async def test_an_unknown_session_reports_failure():
    """What the route turns into a 404."""
    pool = DeletePool(session_rowcount=0)

    assert await clear_session(pool, SESSION) is False


async def test_a_session_with_no_messages_still_deletes():
    """A conversation whose first turn never finished has a session row and no
    messages. Deleting it is a success, not a 404 -- so the return value has to
    read the SESSION rowcount, not the messages one."""
    pool = DeletePool(session_rowcount=1, message_rowcount=0)

    assert await clear_session(pool, SESSION) is True


async def test_uses_placeholders_never_interpolation():
    pool = DeletePool()

    await clear_session(pool, SESSION)

    for sql, params in pool.statements:
        assert SESSION not in sql
        assert params == (SESSION,)
