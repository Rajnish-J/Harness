"""Read access to the Drizzle-owned `credentials` table.

Same two rules as registry_repo.py and workflow_repo.py:

1. Every value goes through a ``%s`` placeholder. Never an f-string, never
   concatenation — not even for a value that "obviously" came from a UUID column.
2. This module emits no schema statements. Drizzle owns every application table.

A third rule applies only here: **this module reads, it never writes.**
``credentials`` is a Next.js-owned table, so the validation verdict from a
connection test is recorded by the route handler that called us, not by us. It
would be one line to do it here and it would quietly give the table two writers.

``secret_ciphertext`` is decrypted at the moment of use and the plaintext is
returned to the caller rather than cached on the row object, so a token lives in
memory for one request rather than for the lifetime of a connection pool.
"""

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings
from app.core.secrets import decrypt_secret

logger = logging.getLogger(__name__)


@dataclass
class CredentialRow:
    id: UUID
    name: str
    provider: str
    username: str | None
    last_four: str
    enabled: bool
    #: Still encrypted. Call `decrypt()` to use it; never log this.
    secret_ciphertext: str

    def decrypt(self, settings: Settings) -> str:
        """The plaintext token. Raises CredentialCryptoError if the key is wrong."""
        return decrypt_secret(self.secret_ciphertext, settings)

    def __repr__(self) -> str:  # pragma: no cover - defensive
        # The default dataclass repr would put the ciphertext in every traceback
        # and log line that touches this object. Narrow, but free to prevent.
        return (
            f"CredentialRow(id={self.id!r}, name={self.name!r}, "
            f"provider={self.provider!r}, last_four={self.last_four!r})"
        )


_COLUMNS = """
    id, name, provider, username, last_four, enabled, secret_ciphertext
"""


def _row(record: dict[str, Any]) -> CredentialRow:
    return CredentialRow(
        id=record["id"],
        name=record["name"],
        provider=record["provider"],
        username=record["username"],
        last_four=record["last_four"],
        enabled=record["enabled"],
        secret_ciphertext=record["secret_ciphertext"],
    )


async def get_credential(
    pool: AsyncConnectionPool, credential_id: str
) -> CredentialRow | None:
    """One credential by id, or None. Disabled rows are returned too.

    Enablement is a policy question for the caller: a connection test should work
    on a disabled credential (that is how you check one before turning it back
    on), while cloning a repository should refuse. Filtering here would decide
    that for both.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from credentials where id = %s",  # noqa: S608
                (credential_id,),
            )
            record = await cur.fetchone()

    return _row(record) if record else None


async def get_enabled_credential(
    pool: AsyncConnectionPool, credential_id: str
) -> CredentialRow | None:
    """One credential, only if it is enabled. For anything that spends the token."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from credentials where id = %s and enabled",  # noqa: S608
                (credential_id,),
            )
            record = await cur.fetchone()

    return _row(record) if record else None
