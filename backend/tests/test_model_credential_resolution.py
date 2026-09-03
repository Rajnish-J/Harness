"""Turning a requested model id into a provider, a key and a client.

The seam the Credentials page plugs into. These tests are pure -- no database,
no network, no provider SDK calls -- because every branch worth pinning is
decided before any I/O happens.
"""

import pytest

from app.agent.llm.catalog import resolve_credentials
from app.agent.llm.factory import client_for, get_llm_client
from app.agent.llm.resolver import (
    NoCredentialError,
    client_for_turn,
    provider_for_model,
)
from app.core.config import get_settings

from tests.test_models_catalog import FakeRow, settings_with


# ----------------------------------------------------------- provider lookup


def test_a_catalogued_id_names_its_own_provider():
    settings = settings_with(llm_provider="anthropic")
    assert provider_for_model("llama-3.3-70b-versatile", settings, {}) == "groq"
    assert provider_for_model("claude-opus-5", settings, {}) == "anthropic"
    assert provider_for_model("gpt-4o", settings, {}) == "openai"


def test_a_namespaced_groq_id_resolves():
    settings = settings_with()
    assert provider_for_model("openai/gpt-oss-120b", settings, {}) == "groq"


def test_an_operators_extra_id_resolves_to_the_credential_that_declared_it():
    settings = settings_with(llm_provider="anthropic")
    credentials = resolve_credentials(
        settings, [FakeRow("groq", extra_models=["some-preview-id"])]
    )
    assert provider_for_model("some-preview-id", settings, credentials) == "groq"


def test_an_unknown_id_falls_back_to_the_configured_provider():
    """A fine-tune the catalog has never heard of should still run."""
    settings = settings_with(llm_provider="openai")
    assert provider_for_model("ft:something:custom", settings, {}) == "openai"


def test_no_id_means_the_configured_provider():
    settings = settings_with(llm_provider="groq")
    assert provider_for_model(None, settings, {}) == "groq"


# ------------------------------------------------------------ client_for_turn


async def test_a_missing_key_is_a_named_error_not_a_crash():
    settings = settings_with()
    with pytest.raises(NoCredentialError) as excinfo:
        await client_for_turn(None, settings, "claude-opus-5", {})
    # The message has to name the fix: it is rendered verbatim in the chat.
    assert "anthropic" in str(excinfo.value)
    assert "Credentials" in str(excinfo.value)


async def test_a_disabled_key_is_refused():
    settings = settings_with()
    credentials = resolve_credentials(settings, [FakeRow("groq", enabled=False)])
    with pytest.raises(NoCredentialError):
        await client_for_turn(None, settings, "llama-3.3-70b-versatile", credentials)


async def test_an_env_key_builds_a_client_without_a_database():
    """Chat predates the database here and must keep working without one."""
    settings = settings_with(groq_api_key="gsk-test", llm_provider="groq")
    credentials = resolve_credentials(settings, [])

    client, model = await client_for_turn(
        None, settings, "llama-3.1-8b-instant", credentials
    )
    assert client.provider == "groq"
    assert model == "llama-3.1-8b-instant"


async def test_the_requested_model_beats_the_environments():
    settings = settings_with(
        llm_provider="anthropic",
        anthropic_api_key="sk-ant-test",
        anthropic_model="claude-opus-5",
    )
    credentials = resolve_credentials(settings, [])

    _client, model = await client_for_turn(
        None, settings, "claude-haiku-4-5", credentials
    )
    assert model == "claude-haiku-4-5"


async def test_a_turn_naming_no_model_still_resolves_one():
    settings = settings_with(groq_api_key="gsk-test", llm_provider="groq")
    credentials = resolve_credentials(settings, [])

    client, model = await client_for_turn(None, settings, None, credentials)
    assert client.provider == "groq"
    assert model


# -------------------------------------------------------------------- factory


def test_client_for_builds_each_provider():
    for provider, model in [
        ("anthropic", "claude-opus-5"),
        ("openai", "gpt-4o"),
        ("groq", "llama-3.3-70b-versatile"),
    ]:
        client = client_for(provider, api_key="k", model=model)
        assert client.provider == provider


def test_client_for_rejects_an_unknown_provider():
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        client_for("cohere", api_key="k", model="command")


def test_groq_accepts_a_base_url_override():
    client = client_for(
        "groq", api_key="k", model="llama-3.1-8b-instant", base_url="http://localhost:8081"
    )
    assert client.provider == "groq"


def test_the_env_only_factory_names_the_fix_when_no_key_is_set():
    """Settings no longer refuses to boot, so this is where it surfaces."""
    with pytest.raises(ValueError, match="No API key"):
        get_llm_client(settings_with(llm_provider="anthropic"))


def test_settings_boots_with_no_provider_key_at_all():
    """A fresh install must start; keys live in the database now."""
    settings = get_settings().model_copy(
        update={"llm_provider": "openai", "openai_api_key": None, "openai_model": None}
    )
    assert settings.env_key_for("openai") is None


# ------------------------------------------------------- the no-leak invariant


def test_no_type_on_the_models_endpoint_can_carry_a_secret():
    """`GET /api/models` must be structurally incapable of leaking a key.

    The endpoint serialises ModelInfo, which is built from ResolvedCredential.
    Neither has a field the ciphertext or the plaintext could occupy, and the
    only code that reads a secret is resolver.client_for_turn. Adding a
    convenient `api_key` to either model to save a query would quietly turn a
    display endpoint into a credential endpoint -- this fails if anyone does.
    """
    from app.agent.llm.catalog import ModelInfo, ResolvedCredential

    forbidden = {
        "secret",
        "secret_ciphertext",
        "ciphertext",
        "api_key",
        "key",
        "token",
    }
    for model in (ResolvedCredential, ModelInfo):
        assert not (forbidden & set(model.model_fields)), (
            f"{model.__name__} gained a secret-bearing field"
        )


def test_the_repo_row_keeps_its_ciphertext_out_of_reprs():
    """A traceback through a turn must not print the stored key."""
    from uuid import uuid4

    from app.db.model_credential_repo import ModelCredentialRow

    row = ModelCredentialRow(
        id=uuid4(),
        provider="groq",
        label=None,
        last_four="4f2a",
        base_url=None,
        extra_models=[],
        enabled=True,
        validated_models=[],
        last_validated_at=None,
        last_validation_error=None,
        secret_ciphertext="v1.nonce.SUPERSECRETPAYLOAD",
    )
    assert "SUPERSECRETPAYLOAD" not in repr(row)
    assert "4f2a" in repr(row)
