"""Persist run progress to Postgres as the graph executes.

Implements the RunRecorder protocol the runner depends on. Recording failures
are logged and swallowed: a database hiccup must not abort a run that is
otherwise working, and the SSE stream is the user's real-time view regardless.
"""

import logging
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import workflow_repo as repo
from app.workflow.schema import WorkflowGraph

logger = logging.getLogger(__name__)


class DatabaseRecorder:
    def __init__(
        self, pool: AsyncConnectionPool, run_id: str, graph: WorkflowGraph
    ) -> None:
        self._pool = pool
        self._run_id = run_id
        self._nodes = graph.node_by_id()
        self._seq = 0
        self._attempts: dict[str, int] = {}
        self._step_ids: dict[str, str] = {}

    async def node_started(self, node_id: str, prompt: str) -> None:
        node = self._nodes.get(node_id)
        self._seq += 1
        # A cycle can revisit a node; each visit is its own step row, which is
        # why (run_id, node_id, attempt) is the unique key rather than
        # (run_id, node_id).
        attempt = self._attempts.get(node_id, 0) + 1
        self._attempts[node_id] = attempt
        try:
            step_id = await repo.start_step(
                self._pool,
                run_id=self._run_id,
                node_id=node_id,
                node_type=node.type if node else "agent",
                label=(node.label or node_id) if node else node_id,
                seq=self._seq,
                attempt=attempt,
                rendered_input=prompt,
            )
            self._step_ids[f"{node_id}:{attempt}"] = str(step_id)
        except Exception:  # noqa: BLE001
            logger.exception("Could not record start of node %s", node_id)

    async def node_finished(self, node_id: str, result: dict[str, Any]) -> None:
        attempt = self._attempts.get(node_id, 1)
        step_id = self._step_ids.get(f"{node_id}:{attempt}")
        if step_id is None:
            logger.warning("No step row for %s attempt %s", node_id, attempt)
            return
        try:
            await repo.finish_step(
                self._pool,
                step_id,
                status=result.get("status", "ok"),
                output=result.get("output"),
                events=result.get("events") or [],
                tool_call_count=result.get("tool_call_count", 0),
                error=result.get("error"),
                duration_ms=result.get("duration_ms", 0),
                input_tokens=result.get("input_tokens"),
                output_tokens=result.get("output_tokens"),
            )
        except Exception:  # noqa: BLE001
            logger.exception("Could not record completion of node %s", node_id)

    async def run_finished(
        self,
        *,
        status: str,
        reason: str,
        error: str | None,
        final_state: Any = None,
    ) -> None:
        try:
            await repo.finish_run(
                self._pool,
                self._run_id,
                status=status,
                done_reason=reason,
                error=error,
                final_state=final_state if isinstance(final_state, dict) else None,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Could not record completion of run %s", self._run_id)
