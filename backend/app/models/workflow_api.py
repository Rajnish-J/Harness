from typing import Any

from pydantic import BaseModel, Field


class RunWorkflowRequest(BaseModel):
    input: str = Field(default="", max_length=100_000)


class ValidateGraphRequest(BaseModel):
    graph: dict[str, Any]


class ValidateGraphResponse(BaseModel):
    ok: bool
    issues: list[dict[str, Any]]


class CancelResponse(BaseModel):
    ok: bool
    cancelled: bool


class ToolInfo(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]
