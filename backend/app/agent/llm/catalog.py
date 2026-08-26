"""The model catalog the composer's model picker renders.

Hand-maintained rather than fetched: the harness supports two providers, only
one of which is configured at a time, and the picker has to show the *other*
provider's models as unavailable rather than pretend they do not exist.

Prices are list prices per million tokens, for display only — nothing here
bills anything. They drift, so they live in one table with a date stamp instead
of being scattered through the UI.
"""

from pydantic import BaseModel, Field

from app.core.config import Settings
from app.models.chat import MODEL_ID_PATTERN

#: When the prices below were last checked against the providers' pricing pages.
PRICING_AS_OF = "2026-06-24"


class ModelInfo(BaseModel):
    """One row in the picker.

    `available` and `default` are computed per request from the running
    configuration — see `models_for` — because the same catalog entry is a
    live choice on one deployment and a greyed-out row on another.
    """

    id: str = Field(pattern=MODEL_ID_PATTERN)
    label: str
    provider: str
    description: str
    context_tokens: int | None = None
    #: None where we have no price we are confident enough to display.
    input_per_mtok: float | None = None
    output_per_mtok: float | None = None
    available: bool = False
    default: bool = False


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
]


def configured_model(settings: Settings) -> str | None:
    """The model id this deployment actually runs, per LLM_PROVIDER."""
    if settings.llm_provider == "anthropic":
        return settings.anthropic_model
    return settings.openai_model


def models_for(settings: Settings) -> list[ModelInfo]:
    """The catalog as this deployment sees it.

    Only the configured provider's models are selectable; the rest are returned
    as unavailable so the picker can show what switching provider would buy
    rather than silently hiding it.

    A configured model that is not in the catalog (a preview id, a fine-tune,
    anything newer than this file) is synthesized rather than dropped — the
    picker must never fail to show what the harness is currently running.
    """
    current = configured_model(settings)
    rows = [
        model.model_copy(
            update={
                "available": model.provider == settings.llm_provider,
                "default": model.id == current,
            }
        )
        for model in MODEL_CATALOG
    ]

    if current and not any(model.default for model in rows):
        rows.insert(
            0,
            ModelInfo(
                id=current,
                label=current,
                provider=settings.llm_provider,
                description="Configured in this harness's environment.",
                available=True,
                default=True,
            ),
        )

    return rows
