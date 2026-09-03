from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Environment-driven configuration for the harness core."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # The provider a turn falls back to when no model credential in the
    # database covers the requested model. Registered keys take precedence
    # over everything below -- see app/agent/llm/resolver.py.
    llm_provider: Literal["anthropic", "openai", "groq"] = "anthropic"

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5"

    openai_api_key: str | None = None
    openai_model: str | None = None

    groq_api_key: str | None = None
    groq_model: str | None = None

    workspace_root: Path = BACKEND_ROOT / "workspace"
    max_agent_iterations: int = 8
    max_file_bytes: int = 200_000

    # ---- Execution tools ---------------------------------------------------
    command_timeout_seconds: float = 30.0
    max_command_output_bytes: int = 200_000
    # Optional project commands for run_tests/run_lint/run_build. None means
    # the tool refuses with a clear message rather than guessing a framework.
    test_command: str | None = None
    lint_command: str | None = None
    build_command: str | None = None

    # Workflow subsystem. `database_url` is deliberately optional: chat must
    # keep working with no database, and /api/workflows/* returns 503 instead.
    database_url: str | None = None

    # ---- Credentials -------------------------------------------------------
    # Base64 of 32 random bytes, and it must be the SAME value as the frontend's
    # CREDENTIALS_ENCRYPTION_KEY: Next.js encrypts tokens, this side decrypts
    # them. Optional for the same reason database_url is — chat works without
    # it, and the credential endpoints 503 rather than the server refusing to
    # boot.
    credentials_encryption_key: str | None = None

    # ---- Project containers ------------------------------------------------
    # One container per project, so a repo's toolchain never has to exist on the
    # host. Debian-slim with Node because that suits most repos this harness
    # will see; a Python repo wants a different image, which is why this is
    # configurable rather than hard-coded.
    default_project_image: str = "node:22-bookworm-slim"
    # Published so a dev server started inside the container is reachable. The
    # HOST port is chosen by Docker, not by us -- it already solves allocation.
    project_container_port: int = 3000
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

    # Ceiling on the composed system prompt (base + agent + attached skills).
    # A runaway skill body would otherwise silently eat the context window.
    max_system_prompt_chars: int = 120_000

    # ---- MCP --------------------------------------------------------------
    # True returns plausible fake tools instead of connecting anything. No
    # subprocess is spawned, so this is how to work on the UI without Node and
    # how CI exercises the tool-wrapping path.
    mock_mcp: bool = False
    # Off by default: the tool list is part of the prompt, so auto-attaching
    # every configured server would silently inflate the cost of every chat.
    mcp_attach_all_enabled: bool = False
    mcp_connect_timeout: float = 20.0
    mcp_list_timeout: float = 15.0
    mcp_tool_timeout: float = 60.0
    mcp_idle_timeout: float = 300.0
    # How long a server that failed to start is left alone, so a broken one is
    # not respawned on every single message.
    mcp_retry_cooldown: float = 30.0

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

    def env_model_for(self, provider: str) -> str | None:
        """The model id this environment names for a provider, if any.

        Anthropic has a default because its ids are stable enough to pin one.
        The other two do not: model naming drifts fastest at the cheap end, and
        a stale hardcoded id fails at request time with a confusing 404 rather
        than at startup with a fixable message.
        """
        return {
            "anthropic": self.anthropic_model,
            "openai": self.openai_model,
            "groq": self.groq_model,
        }.get(provider)

    def env_key_for(self, provider: str) -> str | None:
        """The API key this environment holds for a provider, if any.

        This is the FALLBACK source. A key registered on the Credentials page
        wins, which is what lets an operator add a provider without touching
        `.env` or restarting the process -- `get_settings()` is lru_cached, so
        an env-only design could never pick up a new key live.
        """
        return {
            "anthropic": self.anthropic_api_key,
            "openai": self.openai_api_key,
            "groq": self.groq_api_key,
        }.get(provider)


@lru_cache
def get_settings() -> Settings:
    return Settings()
