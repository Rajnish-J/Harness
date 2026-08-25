from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Environment-driven configuration for the harness core."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    llm_provider: Literal["anthropic", "openai"] = "anthropic"

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5"

    openai_api_key: str | None = None
    openai_model: str | None = None

    workspace_root: Path = BACKEND_ROOT / "workspace"
    max_agent_iterations: int = 8
    max_file_bytes: int = 200_000

    # Workflow subsystem. `database_url` is deliberately optional: chat must
    # keep working with no database, and /api/workflows/* returns 503 instead.
    database_url: str | None = None
    db_pool_min: int = 1
    db_pool_max: int = 5

    max_workflow_nodes: int = 50
    # recursion_limit counts SUPER-STEPS, not node visits — a wide graph burns
    # this faster than its node count suggests.
    max_workflow_supersteps: int = 50
    # What enters graph state, which is re-serialized into a checkpoint every
    # super-step. Full output goes to workflow_run_steps.output instead.
    max_node_output_chars: int = 20_000
    max_interpolated_chars: int = 8_000

    # NoDecode is required: without it pydantic-settings JSON-decodes complex
    # types straight from the env source, so `CORS_ORIGINS=http://localhost:3000`
    # fails as invalid JSON before any validator can split it.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        # Env vars arrive as a single comma-separated string.
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("workspace_root", mode="after")
    @classmethod
    def _absolutize_workspace(cls, value: Path) -> Path:
        # A relative WORKSPACE_ROOT should resolve against the backend dir,
        # not whatever cwd uvicorn happened to start in.
        return value if value.is_absolute() else (BACKEND_ROOT / value).resolve()

    @model_validator(mode="after")
    def _require_provider_credentials(self) -> "Settings":
        if self.llm_provider == "anthropic" and not self.anthropic_api_key:
            raise ValueError(
                "LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set."
            )
        if self.llm_provider == "openai":
            if not self.openai_api_key:
                raise ValueError(
                    "LLM_PROVIDER=openai requires OPENAI_API_KEY to be set."
                )
            if not self.openai_model:
                # No default: model naming drifts, and a stale hardcoded id
                # fails at request time with a confusing 404.
                raise ValueError(
                    "LLM_PROVIDER=openai requires OPENAI_MODEL to be set "
                    "(e.g. OPENAI_MODEL=gpt-4o)."
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
