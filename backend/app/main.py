import asyncio
import contextlib
import logging
from typing import Any
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    chat,
    containers,
    credentials,
    health,
    mcp as mcp_api,
    memory as memory_api,
    model_credentials,
    project_files,
    project_git,
    projects,
    workflows,
)
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()
settings.workspace_root.mkdir(parents=True, exist_ok=True)


async def _sweep_mcp_idle(manager, idle_timeout: float) -> None:
    """Close MCP connections nobody has used lately, forever.

    McpManager tracks `last_used` purely for this, and MCP_IDLE_TIMEOUT was a
    setting with no effect until this task existed: sweep_idle was written and
    never called, so a stdio server's child process lived until the process did.

    One bad sweep must not kill the task -- a manager that raises once would
    otherwise silently disable idle cleanup for the rest of the process's life.
    The interval is capped at a minute so a long idle timeout does not mean a
    correspondingly coarse sweep.
    """
    interval = max(1.0, min(60.0, idle_timeout))
    while True:
        await asyncio.sleep(interval)
        try:
            await manager.sweep_idle()
        except Exception:  # noqa: BLE001 - one failure must not end the loop
            logger.exception("MCP idle sweep failed")


async def _index_builtin_tools(pool: Any) -> None:
    """Record the harness's own tools so routing can pick them without a model.

    The built-ins are static -- they are ALL_TOOLS, fixed at import -- so once
    per boot is exactly often enough, and a replace keeps the table honest when
    a release adds or removes one.

    Best-effort: an index that failed to write costs a routing call, which is
    what every turn paid before the index existed. It must never stop the app
    from starting.
    """
    from app.agent.tools.registry import ALL_TOOLS
    from app.agent.tools.router import first_sentence
    from app.db import tool_index_repo

    rows = [
        tool_index_repo.ToolIndexRow(
            raw_name=tool.name,
            tool_name=tool.name,
            description=first_sentence(tool.description),
            group=tool.group,
            keywords=tool_index_repo.keywords_for(tool.name, first_sentence(tool.description)),
            server_id=None,
        )
        for tool in ALL_TOOLS
    ]
    try:
        await tool_index_repo.replace_builtins(pool, rows)
        logger.info("Indexed %d built-in tools", len(rows))
    except Exception:  # noqa: BLE001 - never fatal at startup
        logger.exception("could not index the built-in tools")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Open the shared pool and the LangGraph checkpointer, if configured.

    A missing DATABASE_URL is not an error: chat must keep working standalone,
    and the workflow routes return 503 instead.
    """
    app.state.pool = None
    app.state.checkpointer = None

    # MCP does not need the database to exist, only to resolve server rows, so
    # the manager is always available. It opens connections lazily.
    from app.mcp.manager import McpManager

    app.state.mcp = McpManager(settings)
    sweeper = asyncio.create_task(
        _sweep_mcp_idle(app.state.mcp, settings.mcp_idle_timeout)
    )

    if settings.database_url:
        # Imported lazily so the app still boots if psycopg is unavailable.
        from app.db.pool import make_checkpointer, make_pool

        pool = make_pool(settings)
        await pool.open(wait=True)
        app.state.pool = pool
        app.state.checkpointer = await make_checkpointer(pool)
        logger.info("Workflow subsystem ready")
        await _index_builtin_tools(pool)
    else:
        logger.info("DATABASE_URL unset — workflows disabled, chat available")

    try:
        yield
    finally:
        # The sweeper goes before aclose: both take the manager's lock, and a
        # sweep landing mid-shutdown would race the close for it.
        sweeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper
        # MCP first: its child processes are reached through this manager, and
        # closing them after the pool would leave them running a moment longer
        # for no reason.
        await app.state.mcp.aclose()
        if app.state.pool is not None:
            await app.state.pool.close()


app = FastAPI(
    title="Harness Core",
    description="Agent loop, tool execution, workflow orchestration, guardrails.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,  # no cookies or auth in this milestone
    # Every method the routers actually serve. DELETE and PATCH were missing,
    # which silently blocked chat deletion and the whole memory admin surface:
    # the browser's preflight was rejected before FastAPI ever saw the request.
    # Only the clients that call API_BASE cross-origin (api.ts, memory-api.ts)
    # are affected -- the ones on relative Next routes are same-origin, never
    # preflight, and so never noticed the gap. No router defines PUT yet.
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(mcp_api.router)
app.include_router(workflows.router)
app.include_router(credentials.router)
app.include_router(model_credentials.router)
app.include_router(projects.router)
app.include_router(containers.router)
app.include_router(project_files.router)
app.include_router(project_git.router)
app.include_router(memory_api.router)
