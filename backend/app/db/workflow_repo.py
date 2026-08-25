"""Raw parameterized SQL against the Drizzle-owned tables.

Two rules, both enforced by tests:

1. Every value goes through a `%s` placeholder. Never an f-string, never
   concatenation — not even for values that "obviously" came from a UUID column.
2. This module emits NO DDL. Drizzle owns every application table; the only DDL
   in the whole backend is LangGraph's own `checkpointer.setup()`.

There is deliberately no ORM here: the Drizzle schema is the single source of
truth, and duplicating it in Python is how the two silently drift apart.
"""

import json
import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)


@dataclass
class WorkflowRow:
    id: UUID
    name: str
    version: int
    graph: dict[str, Any]


async def get_workflow(pool: AsyncConnectionPool, workflow_id: str) -> WorkflowRow | None:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            select id, name, version, graph
            from workflows
            where id = %s and archived_at is null
            """,
            (workflow_id,),
        )
        row = await cur.fetchone()
    if row is None:
        return None
    return WorkflowRow(
        id=row["id"], name=row["name"], version=row["version"], graph=row["graph"]
    )


async def create_run(
    pool: AsyncConnectionPool,
    *,
    run_id: str,
    workflow_id: str,
    workflow_version: int,
    user_input: str,
    graph_snapshot: dict[str, Any],
) -> str:
    """Insert the run row using a caller-supplied id.

    The id is generated before the insert because it is needed in three places
    at once: the sandbox directory name, the LangGraph checkpoint thread id, and
    the `workflow_started` frame. Letting the database mint it would mean a
    round trip before any of those can be decided.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            insert into workflow_runs
                (id, workflow_id, workflow_version, thread_id, status, input,
                 graph_snapshot)
            values (%s, %s, %s, %s, 'running', %s, %s)
            returning id
            """,
            (
                run_id,
                workflow_id,
                workflow_version,
                run_id,  # one run, one checkpoint thread
                user_input,
                json.dumps(graph_snapshot),
            ),
        )
        row = await cur.fetchone()
    return str(row["id"])


async def finish_run(
    pool: AsyncConnectionPool,
    run_id: str,
    *,
    status: str,
    done_reason: str,
    error: str | None,
    final_state: dict[str, Any] | None = None,
) -> None:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            update workflow_runs
               set status = %s,
                   done_reason = %s,
                   error = %s,
                   final_state = %s,
                   finished_at = now()
             where id = %s
            """,
            (
                status,
                done_reason,
                error,
                json.dumps(final_state) if final_state is not None else None,
                run_id,
            ),
        )


async def is_cancel_requested(pool: AsyncConnectionPool, run_id: str) -> bool:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            "select cancel_requested from workflow_runs where id = %s", (run_id,)
        )
        row = await cur.fetchone()
    return bool(row and row["cancel_requested"])


async def request_cancel(pool: AsyncConnectionPool, run_id: str) -> bool:
    """Flag a run for cancellation. Returns False if it had already finished."""
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            update workflow_runs
               set cancel_requested = true
             where id = %s and status in ('queued', 'running')
            returning id
            """,
            (run_id,),
        )
        row = await cur.fetchone()
    return row is not None


async def get_run(pool: AsyncConnectionPool, run_id: str) -> dict[str, Any] | None:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            select id, workflow_id, workflow_version, thread_id, status,
                   cancel_requested, input, graph_snapshot, error, done_reason,
                   started_at, finished_at
              from workflow_runs
             where id = %s
            """,
            (run_id,),
        )
        return await cur.fetchone()


async def start_step(
    pool: AsyncConnectionPool,
    *,
    run_id: str,
    node_id: str,
    node_type: str,
    label: str | None,
    seq: int,
    attempt: int,
    rendered_input: str,
) -> UUID:
    """Insert (or re-open) the step row for one node execution.

    The unique key is (run_id, node_id, attempt); a cycle revisiting a node
    arrives with a higher attempt. ON CONFLICT keeps a retried super-step from
    exploding on a duplicate key.
    """
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            insert into workflow_run_steps
                (run_id, node_id, node_type, label, seq, attempt, status, input)
            values (%s, %s, %s, %s, %s, %s, 'running', %s)
            on conflict (run_id, node_id, attempt) do update
                set status = 'running',
                    input = excluded.input,
                    started_at = now(),
                    finished_at = null
            returning id
            """,
            (run_id, node_id, node_type, label, seq, attempt, rendered_input),
        )
        row = await cur.fetchone()
    return row["id"]


async def finish_step(
    pool: AsyncConnectionPool,
    step_id: str,
    *,
    status: str,
    output: str | None,
    events: list[Any],
    tool_call_count: int,
    error: str | None,
) -> None:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            update workflow_run_steps
               set status = %s,
                   output = %s,
                   events = %s,
                   tool_call_count = %s,
                   error = %s,
                   finished_at = now()
             where id = %s
            """,
            (status, output, json.dumps(events), tool_call_count, error, step_id),
        )


async def list_runs(
    pool: AsyncConnectionPool, workflow_id: str, *, limit: int = 25
) -> list[dict[str, Any]]:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            select id, status, done_reason, input, error, started_at, finished_at
              from workflow_runs
             where workflow_id = %s
             order by started_at desc
             limit %s
            """,
            (workflow_id, limit),
        )
        return list(await cur.fetchall())


async def list_run_steps(pool: AsyncConnectionPool, run_id: str) -> list[dict[str, Any]]:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(
            """
            select id, node_id, node_type, label, seq, attempt, status, input,
                   output, events, tool_call_count, error, started_at, finished_at
              from workflow_run_steps
             where run_id = %s
             order by seq asc
            """,
            (run_id,),
        )
        return list(await cur.fetchall())


async def ping(pool: AsyncConnectionPool) -> bool:
    try:
        async with pool.connection() as conn, conn.cursor() as cur:
            await cur.execute("select 1 as ok")
            await cur.fetchone()
        return True
    except Exception:  # noqa: BLE001 - health check must never raise
        logger.exception("Database ping failed")
        return False
