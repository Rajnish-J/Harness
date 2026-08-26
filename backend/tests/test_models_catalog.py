"""The model catalog: ids the chat contract accepts, one default per config."""

import re

from app.agent.llm.catalog import MODEL_CATALOG, configured_model, models_for
from app.core.config import get_settings
from app.models.chat import MODEL_ID_PATTERN, ChatRequest


def test_every_id_is_accepted_by_the_chat_contract():
    """The picker feeds these straight back as ChatRequest.model."""
    for model in MODEL_CATALOG:
        assert re.match(MODEL_ID_PATTERN, model.id)
        ChatRequest(session_id="s", message="m", model=model.id)


def test_only_the_configured_provider_is_selectable():
    settings = get_settings().model_copy(
        update={"llm_provider": "anthropic", "anthropic_model": "claude-opus-5"}
    )

    rows = models_for(settings)
    assert {row.provider for row in rows if row.available} == {"anthropic"}
    # The other provider is shown, not hidden — that is the point of the row.
    assert any(row.provider == "openai" and not row.available for row in rows)


def test_exactly_one_default():
    settings = get_settings().model_copy(
        update={"llm_provider": "anthropic", "anthropic_model": "claude-sonnet-5"}
    )

    defaults = [row.id for row in models_for(settings) if row.default]
    assert defaults == ["claude-sonnet-5"]


def test_an_uncatalogued_configured_model_is_synthesized():
    """The picker must always show what the harness is actually running."""
    settings = get_settings().model_copy(
        update={"llm_provider": "anthropic", "anthropic_model": "claude-future-9"}
    )

    rows = models_for(settings)
    assert rows[0].id == "claude-future-9"
    assert rows[0].default and rows[0].available
    assert configured_model(settings) == "claude-future-9"
