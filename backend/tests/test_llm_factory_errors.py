"""A missing provider SDK must name the package and the fix.

Regression cover for a real failure: `groq` was pinned in requirements.txt but
absent from the venv, and because each client module imports its SDK at module
scope while the factory imports the client module lazily, nothing noticed until
the first chat turn -- which then reported only "LLM provider misconfigured".
"""

import sys

import pytest

from app.agent.llm.errors import ProviderSDKMissingError
from app.agent.llm.factory import client_for

CLIENT_MODULES = {
    "anthropic": "app.agent.llm.anthropic_client",
    "openai": "app.agent.llm.openai_client",
    "groq": "app.agent.llm.groq_client",
}


class _BlockImport:
    """A meta_path finder that makes one top-level module look uninstalled.

    The honest simulation: ModuleNotFoundError raised from the import system
    itself, with `name` set the way a genuinely absent package sets it.
    """

    def __init__(self, blocked: str) -> None:
        self.blocked = blocked

    def find_spec(self, fullname, path=None, target=None):
        if fullname == self.blocked or fullname.startswith(self.blocked + "."):
            raise ModuleNotFoundError(f"No module named {fullname!r}", name=fullname)
        return None


@pytest.fixture
def uninstall(monkeypatch):
    """Make `name` unimportable for one test, cache and all."""

    def _uninstall(name: str, client_module: str) -> None:
        # Both caches have to go: the SDK itself, and the client module that
        # imported it, or the lazy import in client_for is a no-op re-use.
        for cached in [m for m in sys.modules if m == name or m.startswith(name + ".")]:
            monkeypatch.delitem(sys.modules, cached, raising=False)
        monkeypatch.delitem(sys.modules, client_module, raising=False)
        monkeypatch.setattr(sys, "meta_path", [_BlockImport(name), *sys.meta_path])

    return _uninstall


@pytest.mark.parametrize("provider", sorted(CLIENT_MODULES))
def test_missing_sdk_names_the_package_and_the_pip_command(provider, uninstall):
    uninstall(provider, CLIENT_MODULES[provider])

    with pytest.raises(ProviderSDKMissingError) as caught:
        client_for(provider, api_key="k", model="m")

    message = str(caught.value)
    assert provider in message
    assert "pip install -r backend/requirements.txt" in message
    # The sentence that explains why a working "Test key" button coexists with
    # a failing chat. Losing it would undo the point of the exception.
    assert "raw HTTP" in message
    assert caught.value.provider == provider
    assert caught.value.module == provider


def test_an_unrelated_missing_module_is_not_relabelled(uninstall, monkeypatch):
    """A dependency failing *inside* an SDK is a different bug; let it through."""
    uninstall("some_transitive_dep", CLIENT_MODULES["groq"])

    def explode(*_args, **_kwargs):
        raise ModuleNotFoundError(
            "No module named 'some_transitive_dep'", name="some_transitive_dep"
        )

    monkeypatch.setattr("app.agent.llm.groq_client.GroqClient", explode)

    with pytest.raises(ModuleNotFoundError) as caught:
        client_for("groq", api_key="k", model="m")
    assert not isinstance(caught.value, ProviderSDKMissingError)
    assert caught.value.name == "some_transitive_dep"


@pytest.mark.parametrize(
    ("provider", "model"),
    [
        ("anthropic", "claude-opus-5"),
        ("openai", "gpt-4o"),
        ("groq", "llama-3.3-70b-versatile"),
    ],
)
def test_installed_providers_still_build(provider, model):
    """The try/except must not have swallowed the happy path."""
    client = client_for(provider, api_key="test-key", model=model)
    assert client.provider == provider


def test_unsupported_provider_still_raises_value_error():
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        client_for("mistral", api_key="k", model="m")


def test_every_supported_provider_has_a_fallback_model():
    """A fourth provider added to one table and not the other is a silent bug."""
    from app.agent.llm.factory import _SDK_MODULE
    from app.agent.llm.resolver import _PROVIDER_FALLBACK_MODEL

    assert set(_SDK_MODULE) == set(_PROVIDER_FALLBACK_MODEL)
