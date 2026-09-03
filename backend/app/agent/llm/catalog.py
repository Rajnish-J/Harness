"""The model catalog the composer's model picker renders.

Hand-maintained rather than fetched. Every provider exposes a models endpoint,
but none of them return the two things this table exists to supply -- a written
description and a price -- so fetching would mean rendering a bare list of ids
and losing the reason to have a picker at all. What IS fetched is which keys
work, and that arrives separately as credential health.

Availability is computed per request from the registered credentials, not from
`LLM_PROVIDER`. A model is selectable when its provider has an enabled key on
the Credentials page (or, failing that, a key in `.env`) -- so adding a provider
is a UI action, not an edit-and-restart. Models with no key behind them are
still listed, greyed out, because "you have not set this up" is more useful than
silence.

Health rides on the same rows. A key that was rejected or rate-limited on its
last test says so in the picker, which is the difference between finding out
before you send a message and finding out after.

Prices are list prices per million tokens, for display only -- nothing here
bills anything. They drift, so they live in one table with a date stamp instead
of being scattered through the UI.
"""

from datetime import datetime
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from app.core.config import Settings
from app.models.chat import MODEL_ID_MAX_LENGTH, MODEL_ID_PATTERN

#: When the prices below were last checked against the providers' pricing pages.
PRICING_AS_OF = "2026-06-24"


#: The verdict from a credential's last test, or why there is no verdict.
#: `unknown` means "registered but never tested" -- not a failure, just silence.
CredentialStatus = Literal["ok", "unknown", "rejected", "missing"]


class ModelInfo(BaseModel):
    """One row in the picker.

    Everything from `available` down is computed per request -- see `models_for`
    -- because the same catalog entry is a live choice on one deployment, a
    greyed-out row on another, and a red "key rejected" row on a third.
    """

    id: str = Field(pattern=MODEL_ID_PATTERN, max_length=MODEL_ID_MAX_LENGTH)
    label: str
    provider: str
    description: str
    context_tokens: int | None = None
    #: None where we have no price we are confident enough to display.
    input_per_mtok: float | None = None
    output_per_mtok: float | None = None
    #: True when this model's provider has an enabled key behind it. A rejected
    #: or rate-limited key stays available on purpose: the limit may have reset,
    #: and refusing to let someone retry is worse than letting them try and see.
    available: bool = False
    default: bool = False
    #: Where the key came from. None when there is no key for this provider.
    credential_source: Literal["db", "env"] | None = None
    status: CredentialStatus = "missing"
    #: The provider's own words on the last failure, shown under the model.
    status_message: str | None = None
    checked_at: datetime | None = None


#: Ordered most capable first — the picker renders this order as-is.
MODEL_CATALOG: list[ModelInfo] = [
    ModelInfo(
        id="claude-fable-5",
        label="Fable 5",
        provider="anthropic",
        description=(
            "Anthropic's most capable model, for demanding reasoning and "
            "long-horizon agentic work. Thinking is always on."
        ),
        context_tokens=1_000_000,
        input_per_mtok=10.0,
        output_per_mtok=50.0,
    ),
    ModelInfo(
        id="claude-opus-5",
        label="Opus 5",
        provider="anthropic",
        description=(
            "The default. Deep reasoning with adaptive thinking on by "
            "default, and the best all-round choice for tool use."
        ),
        context_tokens=1_000_000,
        input_per_mtok=5.0,
        output_per_mtok=25.0,
    ),
    ModelInfo(
        id="claude-sonnet-5",
        label="Sonnet 5",
        provider="anthropic",
        description=(
            "Most of Opus's capability at a lower price. A good fit for "
            "high-volume turns where cost matters more than depth."
        ),
        context_tokens=1_000_000,
        input_per_mtok=2.0,
        output_per_mtok=10.0,
    ),
    ModelInfo(
        id="claude-haiku-4-5",
        label="Haiku 4.5",
        provider="anthropic",
        description=(
            "Fastest and cheapest. Best for simple, speed-critical turns "
            "rather than multi-step tool work."
        ),
        context_tokens=200_000,
        input_per_mtok=1.0,
        output_per_mtok=5.0,
    ),
    # Prices deliberately omitted: this project pins Anthropic's from their
    # published table, and a half-remembered OpenAI number displayed as fact
    # is worse than an honest blank.
    ModelInfo(
        id="gpt-4o",
        label="GPT-4o",
        provider="openai",
        description="OpenAI's general-purpose multimodal model.",
        context_tokens=128_000,
    ),
    ModelInfo(
        id="gpt-4o-mini",
        label="GPT-4o mini",
        provider="openai",
        description="The small, cheap OpenAI model.",
        context_tokens=128_000,
    ),
    # Groq serves open-weights models on its own inference hardware. The draw is
    # latency rather than capability, so the descriptions say where each one
    # earns its place rather than repeating "fast" four times. Ids are taken
    # from the SDK's own Literal, which is why several carry a `/` namespace --
    # see MODEL_ID_PATTERN, which had to be widened to accept them.
    ModelInfo(
        id="llama-3.3-70b-versatile",
        label="Llama 3.3 70B",
        provider="groq",
        description=(
            "The strongest general-purpose model on Groq, and the sensible "
            "default here. Handles tool calling reliably enough for agent turns."
        ),
        context_tokens=128_000,
    ),
    ModelInfo(
        id="openai/gpt-oss-120b",
        label="GPT-OSS 120B",
        provider="groq",
        description=(
            "OpenAI's open-weights release, served by Groq. The best reasoning "
            "available here, at the cost of being the slowest of these."
        ),
        context_tokens=128_000,
    ),
    ModelInfo(
        id="moonshotai/kimi-k2-instruct",
        label="Kimi K2",
        provider="groq",
        description=(
            "A large mixture-of-experts model that is unusually strong at "
            "long multi-step tool use for its price."
        ),
        context_tokens=128_000,
    ),
    ModelInfo(
        id="llama-3.1-8b-instant",
        label="Llama 3.1 8B",
        provider="groq",
        description=(
            "Fastest and cheapest here by a wide margin. Good for classification "
            "and short rewrites; not for multi-step tool work."
        ),
        context_tokens=128_000,
    ),
]


class CredentialLike(Protocol):
    """The shape `models_for` needs from a credential row.

    A Protocol rather than an import of ModelCredentialRow: this module is pure
    -- it has no database imports and no I/O -- and the tests construct fakes
    with exactly these fields. Keeping the dependency pointing this way is what
    lets the catalog be tested without a Postgres.
    """

    provider: str
    enabled: bool
    extra_models: list[str]
    last_validated_at: object
    last_validation_error: str | None


class ResolvedCredential(BaseModel):
    """One provider's usable key, wherever it came from.

    `models_for` and the turn resolver both work from this rather than from a
    database row, so the `.env` fallback is a first-class case instead of a
    branch threaded through every caller.

    Note what is NOT on this model: the key. It carries only the metadata the
    picker renders -- existence, enablement, and the last verdict -- which is
    what makes `GET /api/models` structurally incapable of leaking a secret. The
    ciphertext is fetched separately, and only by the one function that is about
    to spend it (see resolver.client_for_turn). That second query per turn is the
    price of this property and is worth paying.
    """

    provider: str
    source: Literal["db", "env"]
    enabled: bool = True
    extra_models: list[str] = Field(default_factory=list)
    status: CredentialStatus = "unknown"
    status_message: str | None = None
    checked_at: datetime | None = None


def resolve_credentials(
    settings: Settings, rows: list[CredentialLike] | None = None
) -> dict[str, ResolvedCredential]:
    """Fold database rows and `.env` keys into one key-per-provider mapping.

    Database wins. That is the whole point of the Credentials page: a key added
    there takes effect on the next turn, whereas `get_settings()` is lru_cached
    and an `.env` edit needs a process restart. An env key therefore only fills
    in for a provider the database says nothing about.
    """
    resolved: dict[str, ResolvedCredential] = {}

    for row in rows or []:
        if row.last_validation_error:
            status: CredentialStatus = "rejected"
        elif row.last_validated_at:
            status = "ok"
        else:
            # Registered but never tested. Not a failure -- the picker shows it
            # as untested rather than as broken.
            status = "unknown"

        resolved[row.provider] = ResolvedCredential(
            provider=row.provider,
            source="db",
            enabled=row.enabled,
            extra_models=list(row.extra_models or []),
            status=status,
            status_message=row.last_validation_error,
            checked_at=row.last_validated_at,  # type: ignore[arg-type]
        )

    for provider in ("anthropic", "openai", "groq"):
        if provider in resolved:
            continue
        if settings.env_key_for(provider):
            resolved[provider] = ResolvedCredential(
                provider=provider, source="env", status="unknown"
            )

    return resolved


def configured_model(settings: Settings) -> str | None:
    """The model id this deployment names in its environment, if any."""
    return settings.env_model_for(settings.llm_provider)


def default_model(
    settings: Settings, credentials: dict[str, ResolvedCredential]
) -> str | None:
    """Which model a turn runs when the composer names none.

    Preference order, and each step exists because the one before it can fail:
    the environment's own choice if its provider is actually usable; else the
    first usable catalog row; else nothing, which the picker renders as an empty
    state pointing at the Credentials page.
    """
    configured = configured_model(settings)
    if configured:
        credential = credentials.get(settings.llm_provider)
        if credential and credential.enabled:
            return configured

    for model in MODEL_CATALOG:
        credential = credentials.get(model.provider)
        if credential and credential.enabled:
            return model.id

    return None


def models_for(
    settings: Settings, credentials: dict[str, ResolvedCredential] | None = None
) -> list[ModelInfo]:
    """The catalog as this deployment sees it.

    Three things happen here, in order: the curated table is annotated with each
    provider's key and health; every credential's operator-typed extra ids are
    appended as synthesized rows; and whatever `default_model` nominates is
    flagged.

    Rows whose provider has no key are returned rather than filtered, so the
    picker can show what registering a key would buy. That is the same choice
    the previous env-driven version made about the non-configured provider -- it
    is just no longer limited to one provider being live at a time.
    """
    resolved = credentials if credentials is not None else {}
    rows: list[ModelInfo] = []

    for model in MODEL_CATALOG:
        credential = resolved.get(model.provider)
        usable = bool(credential and credential.enabled)
        rows.append(
            model.model_copy(
                update={
                    "available": usable,
                    "credential_source": credential.source if credential else None,
                    "status": credential.status if usable else "missing",
                    "status_message": credential.status_message if usable else None,
                    "checked_at": credential.checked_at if usable else None,
                }
            )
        )

    known = {model.id for model in rows}
    for credential in resolved.values():
        for model_id in credential.extra_models:
            if model_id in known:
                continue
            known.add(model_id)
            rows.append(
                ModelInfo(
                    id=model_id,
                    label=model_id,
                    provider=credential.provider,
                    description=(
                        "Added by hand on the Credentials page. The harness has "
                        "no description or pricing for this one."
                    ),
                    available=credential.enabled,
                    credential_source=credential.source,
                    status=credential.status if credential.enabled else "missing",
                    status_message=(
                        credential.status_message if credential.enabled else None
                    ),
                    checked_at=credential.checked_at if credential.enabled else None,
                )
            )

    current = default_model(settings, resolved)
    if current:
        for index, model in enumerate(rows):
            if model.id == current:
                rows[index] = model.model_copy(update={"default": True})
                break
        else:
            # A configured model that is not in the catalog and was not listed as
            # an extra id -- a preview id, a fine-tune, anything newer than this
            # file. Synthesized rather than dropped: the picker must never fail
            # to show what the harness is actually running.
            credential = resolved.get(settings.llm_provider)
            rows.insert(
                0,
                ModelInfo(
                    id=current,
                    label=current,
                    provider=settings.llm_provider,
                    description="Configured in this harness's environment.",
                    available=True,
                    default=True,
                    credential_source=credential.source if credential else "env",
                    status=credential.status if credential else "unknown",
                    status_message=credential.status_message if credential else None,
                    checked_at=credential.checked_at if credential else None,
                ),
            )

    return rows
