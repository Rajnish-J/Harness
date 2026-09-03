"""GET /api/config: what the settings page reads, and what it must never read.

Called directly rather than through a TestClient, the same way
test_models_catalog.py does — the endpoint is a plain function of Settings and
nothing about the HTTP layer is under test here.
"""

import asyncio
import json

from app.api.chat import config
from app.core.config import get_settings

SECRET_VALUES = {
    "anthropic_api_key": "sk-ant-SUPERSECRET-anthropic",
    "openai_api_key": "sk-openai-SUPERSECRET",
    "database_url": "postgresql://user:hunter2@db.internal:5432/harness",
    "credentials_encryption_key": "Zm9vYmFyYmF6cXV1eDEyMzQ1Njc4OTBhYmNkZWY=",
}


def _config(**overrides) -> dict:
    settings = get_settings().model_copy(update=overrides)
    return asyncio.run(config(settings))


def test_the_original_five_keys_are_unchanged():
    """HarnessStatus reads this endpoint too; widening it must not move them."""
    payload = _config(
        llm_provider="anthropic",
        anthropic_model="claude-opus-5",
        max_agent_iterations=8,
        mock_mcp=False,
    )

    assert payload["provider"] == "anthropic"
    assert payload["model"] == "claude-opus-5"
    assert payload["max_iterations"] == 8
    assert payload["mock_mcp"] is False
    assert isinstance(payload["workspace_root"], str)


def test_no_secret_value_is_ever_serialized():
    """The one that matters. Every secret is set to a recognisable value and
    the whole payload is searched for it."""
    payload = _config(**SECRET_VALUES)
    body = json.dumps(payload)

    for name, value in SECRET_VALUES.items():
        assert value not in body, f"{name} leaked into /api/config"
    # The password inside database_url would survive a naive substring rewrite.
    assert "hunter2" not in body


def test_secrets_report_configured_not_contents():
    configured = _config(**SECRET_VALUES)["secrets"]
    assert configured == {
        "llm_api_key": True,
        "database_url": True,
        "credentials_encryption_key": True,
    }

    missing = _config(
        llm_provider="anthropic",
        anthropic_api_key="present-so-validation-passes",
        openai_api_key=None,
        database_url=None,
        credentials_encryption_key=None,
    )["secrets"]
    assert missing["database_url"] is False
    assert missing["credentials_encryption_key"] is False


def test_unset_project_commands_stay_null():
    """"not set" is a state the UI renders, so it must not be coerced to ''."""
    payload = _config(test_command=None, lint_command="npm run lint", build_command=None)

    assert payload["commands"] == {
        "test": None,
        "lint": "npm run lint",
        "build": None,
    }


def test_limits_and_budgets_are_reported():
    payload = _config(
        max_file_bytes=200_000,
        max_system_prompt_chars=120_000,
        max_workflow_nodes=50,
        db_pool_max=5,
    )

    assert payload["limits"]["max_file_bytes"] == 200_000
    assert payload["limits"]["max_system_prompt_chars"] == 120_000
    assert payload["workflows"]["max_nodes"] == 50
    assert payload["database"]["pool_max"] == 5
    assert isinstance(payload["cors_origins"], list)
