"""The model catalog: ids the chat contract accepts, availability from keys.

These used to assert that exactly one provider was selectable, because
`LLM_PROVIDER` allowed exactly one. Availability now comes from which keys are
registered, so the same questions are asked against credentials instead.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.agent.llm.catalog import (
    MODEL_CATALOG,
    configured_model,
    default_model,
    models_for,
    resolve_credentials,
)
from app.core.config import get_settings
from app.models.chat import MODEL_ID_MAX_LENGTH, MODEL_ID_PATTERN, ChatRequest

CHECKED = datetime(2026, 9, 3, tzinfo=timezone.utc)


@dataclass
class FakeRow:
    """The subset of ModelCredentialRow that `resolve_credentials` reads.

    A hand-rolled fake rather than the real dataclass, matching the style of
    test_mcp_tools.py: the catalog is pure, and constructing a real row would
    drag a ciphertext and a settings object into a test about display logic.
    """

    provider: str
    enabled: bool = True
    extra_models: list[str] = field(default_factory=list)
    last_validated_at: datetime | None = None
    last_validation_error: str | None = None


def settings_with(**overrides):
    """Settings with every provider key cleared, then the overrides applied.

    Clearing first matters: the developer running these tests has real keys in
    backend/.env, and an env fallback firing unasked would make availability
    assertions pass for the wrong reason.
    """
    base = {
        "anthropic_api_key": None,
        "anthropic_model": "claude-opus-5",
        "openai_api_key": None,
        "openai_model": None,
        "groq_api_key": None,
        "groq_model": None,
    }
    return get_settings().model_copy(update={**base, **overrides})


def test_every_id_is_accepted_by_the_chat_contract():
    """The picker feeds these straight back as ChatRequest.model."""
    for model in MODEL_CATALOG:
        assert re.match(MODEL_ID_PATTERN, model.id)
        assert len(model.id) <= MODEL_ID_MAX_LENGTH
        ChatRequest(session_id="s", message="m", model=model.id)


def test_namespaced_groq_ids_survive_the_contract():
    """Groq namespaces ids with a `/`, which the pattern once rejected outright."""
    namespaced = [model.id for model in MODEL_CATALOG if "/" in model.id]
    assert namespaced, "expected at least one namespaced id in the catalog"
    for model_id in namespaced:
        ChatRequest(session_id="s", message="m", model=model_id)


def test_nothing_is_selectable_without_a_key():
    rows = models_for(settings_with(), {})
    assert not any(row.available for row in rows)
    # Listed, not hidden — the picker shows what registering a key would buy.
    assert rows
    assert all(row.status == "missing" for row in rows)


def test_only_providers_with_a_key_are_selectable():
    settings = settings_with()
    credentials = resolve_credentials(settings, [FakeRow("groq")])

    rows = models_for(settings, credentials)
    assert {row.provider for row in rows if row.available} == {"groq"}
    assert any(row.provider == "anthropic" and not row.available for row in rows)


def test_a_database_key_beats_an_env_key():
    """The whole point of the Credentials page: no restart to change providers."""
    settings = settings_with(groq_api_key="gsk-from-env")
    credentials = resolve_credentials(settings, [FakeRow("groq")])

    assert credentials["groq"].source == "db"


def test_an_env_key_fills_in_for_a_provider_the_database_lacks():
    settings = settings_with(anthropic_api_key="sk-ant-from-env")
    credentials = resolve_credentials(settings, [FakeRow("groq")])

    assert credentials["anthropic"].source == "env"
    assert credentials["groq"].source == "db"


def test_a_disabled_key_makes_its_models_unavailable():
    settings = settings_with()
    credentials = resolve_credentials(settings, [FakeRow("groq", enabled=False)])

    rows = models_for(settings, credentials)
    assert not any(row.available for row in rows if row.provider == "groq")


def test_health_rides_along_on_every_row():
    """An expired key must be visible in the picker before a message is sent."""
    settings = settings_with()
    credentials = resolve_credentials(
        settings,
        [FakeRow("groq", last_validated_at=CHECKED, last_validation_error="401 nope")],
    )

    groq_rows = [row for row in models_for(settings, credentials) if row.provider == "groq"]
    assert groq_rows
    for row in groq_rows:
        assert row.status == "rejected"
        assert row.status_message == "401 nope"
        assert row.checked_at == CHECKED
        # Still selectable on purpose: the operator may have just fixed the key,
        # and refusing to let them retry is worse than letting them try.
        assert row.available


def test_a_tested_key_reads_as_ok_and_an_untested_one_as_unknown():
    settings = settings_with()
    tested = resolve_credentials(settings, [FakeRow("groq", last_validated_at=CHECKED)])
    untested = resolve_credentials(settings, [FakeRow("groq")])

    assert tested["groq"].status == "ok"
    assert untested["groq"].status == "unknown"


def test_extra_models_are_synthesized_for_their_provider():
    settings = settings_with()
    credentials = resolve_credentials(
        settings, [FakeRow("groq", extra_models=["qwen/qwen3-32b"])]
    )

    rows = models_for(settings, credentials)
    extra = [row for row in rows if row.id == "qwen/qwen3-32b"]
    assert len(extra) == 1
    assert extra[0].provider == "groq"
    assert extra[0].available
    # No invented pricing: the harness genuinely does not know.
    assert extra[0].input_per_mtok is None


def test_an_extra_model_that_duplicates_the_catalog_is_not_listed_twice():
    settings = settings_with()
    credentials = resolve_credentials(
        settings, [FakeRow("groq", extra_models=["llama-3.3-70b-versatile"])]
    )

    ids = [row.id for row in models_for(settings, credentials)]
    assert ids.count("llama-3.3-70b-versatile") == 1


def test_exactly_one_default():
    settings = settings_with(llm_provider="groq", groq_model="llama-3.1-8b-instant")
    credentials = resolve_credentials(settings, [FakeRow("groq")])

    defaults = [row.id for row in models_for(settings, credentials) if row.default]
    assert defaults == ["llama-3.1-8b-instant"]


def test_the_default_falls_through_to_a_usable_provider():
    """LLM_PROVIDER names anthropic, but only the groq key exists."""
    settings = settings_with(llm_provider="anthropic")
    credentials = resolve_credentials(settings, [FakeRow("groq")])

    chosen = default_model(settings, credentials)
    assert chosen is not None
    provider = next(m.provider for m in MODEL_CATALOG if m.id == chosen)
    assert provider == "groq"


def test_there_is_no_default_when_nothing_is_configured():
    settings = settings_with()
    assert default_model(settings, {}) is None
    assert not any(row.default for row in models_for(settings, {}))


def test_an_uncatalogued_configured_model_is_synthesized():
    """The picker must always show what the harness is actually running."""
    settings = settings_with(
        llm_provider="anthropic",
        anthropic_api_key="sk-ant-x",
        anthropic_model="claude-future-9",
    )
    credentials = resolve_credentials(settings, [])

    rows = models_for(settings, credentials)
    assert rows[0].id == "claude-future-9"
    assert rows[0].default and rows[0].available
    assert configured_model(settings) == "claude-future-9"
