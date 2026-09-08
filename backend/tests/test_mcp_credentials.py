"""Resolving an MCP server's linked credential into an Authorization header.

The bar these tests hold is not just "the happy path works". It is that every
failure mode returns a notice instead of raising — the contract in
app/mcp/__init__.py — and that the token never leaks into one.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.core.config import Settings
from app.core.secrets import encrypt_secret
from app.db.registry_repo import McpServerRow
from app.mcp import credentials as mcp_credentials
from app.mcp.credentials import resolve_auth

# Same key the crypto tests use.
KEY = "c2VjcmV0LWtleS0zMi1ieXRlcy1sb25nLWZvci1hZXM="
TOKEN = "ghp_exampleTokenValue1234"


@pytest.fixture
def settings() -> Settings:
    return Settings(credentials_encryption_key=KEY)


def server_row(credential_id: UUID | None = None) -> McpServerRow:
    return McpServerRow(
        id=uuid4(),
        name="github",
        transport="http",
        command=None,
        args=[],
        url="https://api.githubcopilot.com/mcp/",
        env={},
        headers={},
        credential_id=credential_id,
        enabled=True,
        updated_at=datetime.now(UTC),
    )


class FakeCredentialRow:
    def __init__(self, token: str, settings: Settings, last_four: str = "1234") -> None:
        self.id = uuid4()
        self.last_four = last_four
        self._ciphertext = encrypt_secret(token, settings)

    def decrypt(self, settings: Settings) -> str:
        from app.core.secrets import decrypt_secret

        return decrypt_secret(self._ciphertext, settings)


def patch_lookup(monkeypatch: pytest.MonkeyPatch, result: Any) -> None:
    """Stand in for get_enabled_credential, which needs a live pool."""

    async def fake(pool: Any, credential_id: str) -> Any:
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(mcp_credentials, "get_enabled_credential", fake)


SENTINEL_POOL = object()


@pytest.mark.anyio
async def test_a_server_with_no_credential_costs_nothing(settings: Settings) -> None:
    """The overwhelmingly common case must not touch the database at all."""
    resolved = await resolve_auth(SENTINEL_POOL, settings, server_row(None))

    assert resolved.headers == {}
    assert resolved.notice is None
    assert resolved.fingerprint == ""


@pytest.mark.anyio
async def test_a_linked_credential_becomes_a_bearer_header(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    row = FakeCredentialRow(TOKEN, settings)
    patch_lookup(monkeypatch, row)

    resolved = await resolve_auth(SENTINEL_POOL, settings, server_row(uuid4()))

    assert resolved.headers == {"Authorization": f"Bearer {TOKEN}"}
    assert resolved.notice is None
    # Fingerprint carries identity, never the secret.
    assert resolved.fingerprint == f"{row.id}:1234"
    assert TOKEN not in resolved.fingerprint


@pytest.mark.anyio
async def test_a_missing_or_disabled_credential_is_a_notice_not_a_raise(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """get_enabled_credential returns None for both; the operator needs telling."""
    patch_lookup(monkeypatch, None)

    resolved = await resolve_auth(SENTINEL_POOL, settings, server_row(uuid4()))

    assert resolved.headers == {}
    assert resolved.notice is not None
    assert "missing or disabled" in resolved.notice


@pytest.mark.anyio
async def test_an_undecryptable_credential_is_a_notice(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    """A rotated encryption key must degrade the turn, not crash it."""
    good = Settings(credentials_encryption_key=KEY)
    other = Settings(
        credentials_encryption_key="b3RoZXIta2V5LTMyLWJ5dGVzLWxvbmctZm9yLWFlcw=="
    )
    patch_lookup(monkeypatch, FakeCredentialRow(TOKEN, good))

    resolved = await resolve_auth(SENTINEL_POOL, other, server_row(uuid4()))

    assert resolved.headers == {}
    assert resolved.notice is not None
    assert TOKEN not in resolved.notice


@pytest.mark.anyio
async def test_a_database_read_failure_is_a_notice(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    patch_lookup(monkeypatch, RuntimeError("connection refused"))

    resolved = await resolve_auth(SENTINEL_POOL, settings, server_row(uuid4()))

    assert resolved.headers == {}
    assert resolved.notice is not None
    assert "connection refused" in resolved.notice


@pytest.mark.anyio
async def test_no_pool_is_a_notice_not_a_crash(settings: Settings) -> None:
    """Chat is designed to run without a database; say so and carry on."""
    resolved = await resolve_auth(None, settings, server_row(uuid4()))

    assert resolved.headers == {}
    assert resolved.notice is not None
    assert "DATABASE_URL" in resolved.notice


@pytest.mark.anyio
async def test_the_shared_no_auth_singleton_is_not_mutated(
    settings: Settings,
) -> None:
    """Every unlinked server gets the same object; one must not poison the rest."""
    first = await resolve_auth(SENTINEL_POOL, settings, server_row(None))
    first.headers["Authorization"] = "Bearer leaked"

    second = await resolve_auth(SENTINEL_POOL, settings, server_row(None))
    assert second.headers == {}


def test_repr_does_not_leak_the_token() -> None:
    """This object is one traceback away from a log line."""
    resolved = mcp_credentials.ResolvedAuth(
        headers={"Authorization": f"Bearer {TOKEN}"}, fingerprint="abc:1234"
    )

    assert TOKEN not in repr(resolved)
    assert "Authorization" in repr(resolved)
