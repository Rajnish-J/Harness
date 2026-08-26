"""The chat wire contract.

On why the preset arrives as resolved *text* rather than an `agent_id`:

The browser has already read these rows out of Postgres through Next, and this
service is designed to run with DATABASE_URL unset — see app/main.py and
`_require_db` in app/api/workflows.py. Requiring Python to resolve an agent id
would mean selecting an agent fails on exactly the DB-less setup the README
documents as supported.

MCP is the deliberate exception: those rows carry plaintext credentials, so only
opaque ids cross this boundary and the secret stays server-side.

The honest cost: a caller can send any system prompt it likes. That is already
the trust model here — there is no auth and CORS runs with allow_credentials
False, so the boundary is "whoever can reach this port". If that ever stops
being true, the migration is to accept `agent_id` only and resolve it through
app/db/registry_repo.py.
"""

from typing import Literal

from pydantic import BaseModel, Field

# Permissive enough for every provider's ids, strict enough that the value can
# be dropped into a client constructor without further escaping.
MODEL_ID_PATTERN = r"^[A-Za-z0-9._:\-]{1,100}$"


class SkillPayload(BaseModel):
    """One skill, already resolved by the caller."""

    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(default="", max_length=200)
    description: str | None = Field(default=None, max_length=2_000)
    content: str = Field(default="", max_length=50_000)


#: How the turn treats tools.
#:
#: "agent"  — the model calls tools and the loop runs them (the original
#:            behaviour, which is why it is the default).
#: "manual" — the loop stops at each tool call and waits for POST
#:            /api/chat/approve before running anything.
#: "chat"   — no tools are advertised at all. Plain Q&A.
ToolMode = Literal["agent", "manual", "chat"]


class TurnPreset(BaseModel):
    """Everything that shapes one turn except the message itself.

    Shared by ChatRequest and ApprovalRequest so a resumed turn is rebuilt from
    exactly the same inputs as the turn that paused. The alternative — parking
    the whole turn context on the session — would make this service stateful in
    a way the rest of it deliberately is not.
    """

    session_id: str = Field(min_length=1, max_length=200)

    # ---- preset -----------------------------------------------------------
    # Every field below is optional and defaults to today's behaviour, so a
    # bare {session_id, message} body behaves exactly as it did before presets.
    agent_id: str | None = Field(default=None, max_length=64)
    agent_name: str | None = Field(default=None, max_length=200)
    system_prompt: str | None = Field(default=None, max_length=100_000)
    skills: list[SkillPayload] = Field(default_factory=list, max_length=20)
    #: None means the full registry; a list narrows both schemas and dispatch.
    tool_names: list[str] | None = Field(default=None, max_length=200)
    mcp_server_ids: list[str] = Field(default_factory=list, max_length=20)
    model: str | None = Field(default=None, pattern=MODEL_ID_PATTERN)
    max_iterations: int | None = Field(default=None, ge=1, le=50)
    mode: ToolMode = "agent"


class ChatRequest(TurnPreset):
    message: str = Field(min_length=1, max_length=100_000)


class ApprovalDecision(BaseModel):
    """One verdict on one pending tool call."""

    id: str = Field(min_length=1, max_length=200)
    approved: bool


class ApprovalRequest(TurnPreset):
    """Resume a manual-mode turn that is parked on `session.pending`.

    Decisions are matched to pending calls by id. A pending call with no
    decision is treated as denied — silence must not authorise a write.
    """

    decisions: list[ApprovalDecision] = Field(default_factory=list, max_length=50)


class ResetRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
