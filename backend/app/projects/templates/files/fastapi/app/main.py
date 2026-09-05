"""{{project_name}} -- a FastAPI service."""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="{{project_name}}")


class Health(BaseModel):
    status: str
    service: str


@app.get("/health", response_model=Health)
async def health() -> Health:
    """Liveness probe. Cheap on purpose: no database, no downstream calls."""
    return Health(status="ok", service="{{project_name}}")
