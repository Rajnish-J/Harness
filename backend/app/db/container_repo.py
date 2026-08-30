"""Writes to `project_containers`.

Python-owned, and the only repo here that is mostly writes: the truth about a
container is whether the daemon has one, and only this side talks to the daemon.
Next.js reads these rows to render a status badge and never writes them.

The rows are a cache. `docker rm`, a Docker Desktop restart, or a machine reboot
can all remove a container without anything telling us, so callers reconcile
against the daemon and then call `record()` with what they actually saw. Nothing
here trusts a stored row to still be true.

Same rules as the other repos: `%s` placeholders only, and no DDL.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)


@dataclass
class ContainerRow:
    id: UUID
    project_id: UUID
    container_id: str | None
    container_name: str
    image: str
    status: str
    host_port: int | None
    workspace_path: str | None
    error: str | None


_COLUMNS = """
    id, project_id, container_id, container_name, image, status,
    host_port, workspace_path, error
"""


def _row(record: dict[str, Any]) -> ContainerRow:
    return ContainerRow(
        id=record["id"],
        project_id=record["project_id"],
        container_id=record["container_id"],
        container_name=record["container_name"],
        image=record["image"],
        status=record["status"],
        host_port=record["host_port"],
        workspace_path=record["workspace_path"],
        error=record["error"],
    )


async def get_container(
    pool: AsyncConnectionPool, project_id: str
) -> ContainerRow | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from project_containers where project_id = %s",  # noqa: S608
                (project_id,),
            )
            record = await cur.fetchone()
    return _row(record) if record else None


async def record(
    pool: AsyncConnectionPool,
    project_id: str,
    *,
    container_name: str,
    image: str,
    status: str,
    container_id: str | None = None,
    host_port: int | None = None,
    workspace_path: str | None = None,
    error: str | None = None,
) -> None:
    """Upsert what the daemon just told us.

    One row per project (enforced by a unique constraint), so this is an upsert
    rather than an insert plus a prior existence check -- two statements would
    race with a second browser tab pressing Start at the same moment.
    """
    now = datetime.now(timezone.utc)
    started = now if status == "running" else None
    stopped = now if status in {"stopped", "removed", "error"} else None

    async with pool.connection() as conn:
        await conn.execute(
            """
            insert into project_containers
                (project_id, container_id, container_name, image, status,
                 host_port, workspace_path, error, started_at, stopped_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (project_id) do update set
                container_id   = excluded.container_id,
                container_name = excluded.container_name,
                image          = excluded.image,
                status         = excluded.status,
                host_port      = excluded.host_port,
                workspace_path = excluded.workspace_path,
                error          = excluded.error,
                -- coalesce keeps the ORIGINAL start time across a status
                -- refresh; excluded.started_at is null unless we just started.
                started_at     = coalesce(
                    excluded.started_at, project_containers.started_at
                ),
                stopped_at     = coalesce(
                    excluded.stopped_at, project_containers.stopped_at
                ),
                updated_at     = now()
            """,
            (
                project_id,
                container_id,
                container_name,
                image,
                status,
                host_port,
                workspace_path,
                error[:2000] if error else None,
                started,
                stopped,
            ),
        )


async def forget(pool: AsyncConnectionPool, project_id: str) -> None:
    """Drop the cached row, for when the container is genuinely gone."""
    async with pool.connection() as conn:
        await conn.execute(
            "delete from project_containers where project_id = %s", (project_id,)
        )
