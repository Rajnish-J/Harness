"""Resolve an MCP server's linked credential into an Authorization header.

`mcp_servers.headers` holds plaintext, which is fine for a localhost harness but
not for a GitHub PAT that can push code and merge pull requests. A server may
instead point at a row in the encrypted `credentials` vault; this module is the
bridge, and it is the only place in the MCP path that decrypts anything.

Two rules, both inherited from app/db/credential_repo.py:

1. **Read only.** `credentials` is a Next.js-owned table. Nothing here records a
   verdict, even though a failed connection is evidence about a token.
2. **The plaintext is not retained.** It goes straight into the header dict the
   caller hands to the transport, and is never logged, stored on a row object,
   or interpolated into a notice.

Nothing here raises. A missing, disabled or undecryptable credential comes back
as a notice string, because the contract in app/mcp/__init__.py is that a broken
MCP server degrades a chat turn to the built-in tools rather than failing it.
"""

import logging

from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings
from app.core.secrets import CredentialCryptoError
from app.db.credential_repo import get_enabled_credential
from app.db.registry_repo import McpServerRow

logger = logging.getLogger(__name__)


class ResolvedAuth:
    """Headers for one server, plus the fingerprint that invalidates them.

    `fingerprint` exists because McpManager caches a live connection by
    (server id, mcp_servers.updated_at). Rotating a token edits `credentials`,
    not `mcp_servers`, so without something credential-derived in that key a
    cached runner would keep replaying the old bearer token until the process
    restarted. `last_four` changes whenever the secret does, which is exactly
    the signal needed and is not itself a secret.
    """

    __slots__ = ("headers", "fingerprint", "notice")

    def __init__(
        self,
        headers: dict[str, str],
        fingerprint: str,
        notice: str | None = None,
    ) -> None:
        self.headers = headers
        self.fingerprint = fingerprint
        self.notice = notice

    def __repr__(self) -> str:  # pragma: no cover - defensive
        # `headers` holds a bearer token. The default repr would put it in every
        # traceback that touches this object, which is the one thing this module
        # exists to prevent.
        return (
            f"ResolvedAuth(header_names={sorted(self.headers)!r}, "
            f"fingerprint={self.fingerprint!r}, notice={self.notice!r})"
        )


def no_auth() -> ResolvedAuth:
    """What a server with no linked credential resolves to.

    A function, not a module-level singleton: the alternative hands the same
    mutable dict to every unlinked server, and one caller merging into it would
    silently give every other server that header.
    """
    return ResolvedAuth(headers={}, fingerprint="")


async def resolve_auth(
    pool: AsyncConnectionPool | None,
    settings: Settings,
    server: McpServerRow,
) -> ResolvedAuth:
    """The Authorization header for `server`, or an empty one plus a notice."""
    if server.credential_id is None:
        return no_auth()

    if pool is None:
        return ResolvedAuth(
            headers={},
            fingerprint="",
            notice=(
                f"MCP server {server.name!r} is linked to a stored credential, "
                "but this backend has no DATABASE_URL set."
            ),
        )

    try:
        # `get_enabled_credential`, not `get_credential`: this spends the token.
        # That is the distinction drawn in the credential_repo docstrings — a
        # connection test may probe a disabled row, a real call may not.
        row = await get_enabled_credential(pool, str(server.credential_id))
    except Exception as exc:  # noqa: BLE001 - a read failure is not a chat failure
        logger.warning("Could not read credential for %s: %s", server.name, exc)
        return ResolvedAuth(
            headers={},
            fingerprint="",
            notice=f"Could not read the credential for {server.name!r}: {exc}",
        )

    if row is None:
        return ResolvedAuth(
            headers={},
            fingerprint="missing",
            notice=(
                f"MCP server {server.name!r} is linked to a credential that is "
                "missing or disabled. Re-link it on the server's page, or "
                "re-enable it on the Credentials page."
            ),
        )

    try:
        token = row.decrypt(settings)
    except CredentialCryptoError as exc:
        # The message names the key, never the ciphertext or the plaintext.
        return ResolvedAuth(
            headers={},
            fingerprint="undecryptable",
            notice=(
                f"The credential for MCP server {server.name!r} could not be "
                f"decrypted: {exc}"
            ),
        )

    return ResolvedAuth(
        headers={"Authorization": f"Bearer {token}"},
        fingerprint=f"{row.id}:{row.last_four}",
    )
