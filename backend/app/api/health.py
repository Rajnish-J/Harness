from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz(request: Request) -> dict[str, str]:
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        db = "unconfigured"
    else:
        from app.db import workflow_repo as repo

        db = "ok" if await repo.ping(pool) else "down"
    return {"status": "ok", "db": db}
