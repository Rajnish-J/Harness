import logging
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

    if settings.database_url:
        # Imported lazily so the app still boots if psycopg is unavailable.
        from app.db.pool import make_checkpointer, make_pool

        pool = make_pool(settings)
        await pool.open(wait=True)
        app.state.pool = pool
        app.state.checkpointer = await make_checkpointer(pool)
        logger.info("Workflow subsystem ready")
    else:
        logger.info("DATABASE_URL unset — workflows disabled, chat available")

    try:
        yield
    finally:
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
    allow_methods=["GET", "POST"],
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
