"""Connection pool and LangGraph checkpointer construction.

One pool, shared by the repository and the checkpointer. The checkpointer is the
ONE place this codebase emits DDL, and it does so for its own tables only —
every application table is owned by Drizzle.
"""

import logging

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings

logger = logging.getLogger(__name__)


def make_pool(settings: Settings) -> AsyncConnectionPool:
    """Build (but do not open) the shared pool.

    `row_factory=dict_row` and `prepare_threshold=0` are what the checkpointer's
    own `from_conn_string()` sets: its queries index rows by name, and it breaks
    without dict rows. Disabling prepared statements also matters for pooled
    Postgres endpoints such as Neon's `-pooler` host, where a transaction-mode
    pooler and server-side prepared statements do not mix.
    """
    if not settings.database_url:
        raise ValueError("DATABASE_URL is not configured")

    return AsyncConnectionPool(
        conninfo=settings.database_url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        # Opened explicitly in the lifespan so startup fails loudly, not lazily.
        open=False,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": dict_row,
        },
    )


async def make_checkpointer(pool: AsyncConnectionPool) -> AsyncPostgresSaver:
    """Construct the checkpointer and ensure its tables exist.

    Must be called from inside the running event loop: AsyncPostgresSaver's
    __init__ calls get_running_loop(). Never use from_conn_string() per request
    — it is a context manager that opens and closes a fresh connection, i.e. a
    new TCP+TLS handshake for every run.
    """
    saver = AsyncPostgresSaver(conn=pool)
    await saver.setup()  # idempotent
    logger.info("LangGraph checkpointer ready")
    return saver
