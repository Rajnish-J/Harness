"""Read access to the Drizzle-owned `model_credentials` table.

The same three rules as credential_repo.py, for the same reasons:

1. Every value goes through a ``%s`` placeholder. Never an f-string, never
   concatenation -- not even for a value that "obviously" came from a UUID column.
2. This module emits no schema statements. Drizzle owns every application table.
3. **It reads, it never writes.** ``model_credentials`` is a Next.js-owned table,
   so the verdict from a key test is recorded by the route handler that called
   us, not by us. It would be one line to do it here and it would quietly give
   the table two writers.

``secret_ciphertext`` is decrypted at the moment of use and the plaintext is
returned to the caller rather than cached on the row object, so a key lives in
memory for one request rather than for the lifetime of a connection pool.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings
from app.core.secrets import decrypt_secret

logger = logging.getLogger(__name__)


@dataclass
class ModelCredentialRow:
    id: UUID
    provider: str
    label: str | None
    last_four: str
    base_url: str | None
    extra_models: list[str]
    enabled: bool
    validated_models: list[str]
    last_validated_at: datetime | None
    last_validation_error: str | None
    #: Still encrypted. Call `decrypt()` to use it; never log this.
    secret_ciphertext: str = field(repr=False)

    def decrypt(self, settings: Settings) -> str:
        """The plaintext key. Raises CredentialCryptoError if the key is wrong."""
        return decrypt_secret(self.secret_ciphertext, settings)

    def __repr__(self) -> str:  # pragma: no cover - defensive
        # The default dataclass repr would put the ciphertext in every traceback
        # and log line that touches this object. Narrow, but free to prevent.
        return (
            f"ModelCredentialRow(id={self.id!r}, provider={self.provider!r}, "
            f"last_four={self.last_four!r}, enabled={self.enabled!r})"
        )


_COLUMNS = """
    id, provider, label, last_four, base_url, extra_models, enabled,
    validated_models, last_validated_at, last_validation_error, secret_ciphertext
"""


def _row(record: dict[str, Any]) -> ModelCredentialRow:
    return ModelCredentialRow(
        id=record["id"],
        provider=record["provider"],
        label=record["label"],
        last_four=record["last_four"],
        base_url=record["base_url"],
        extra_models=list(record["extra_models"] or []),
        enabled=record["enabled"],
        validated_models=list(record["validated_models"] or []),
        last_validated_at=record["last_validated_at"],
        last_validation_error=record["last_validation_error"],
        secret_ciphertext=record["secret_ciphertext"],
    )


async def list_model_credentials(
    pool: AsyncConnectionPool,
) -> list[ModelCredentialRow]:
    """Every registered key, enabled or not, ordered by provider.

    Disabled rows are included because the model picker renders them: a provider
    you have deliberately switched off should read as "off", not vanish and leave
    you wondering whether the key was deleted.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from model_credentials order by provider"  # noqa: S608
            )
            return [_row(record) for record in await cur.fetchall()]


async def get_model_credential(
    pool: AsyncConnectionPool, credential_id: str
) -> ModelCredentialRow | None:
    """One key by id, or None. Disabled rows are returned too.

    Enablement is a policy question for the caller -- the same split
    credential_repo.py draws: testing a key should work while it is switched off
    (that is how you check one before turning it back on), while running a turn
    with it must refuse.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from model_credentials where id = %s",  # noqa: S608
                (credential_id,),
            )
            record = await cur.fetchone()

    return _row(record) if record else None


async def get_enabled_model_credential(
    pool: AsyncConnectionPool, provider: str
) -> ModelCredentialRow | None:
    """The enabled key for a provider, or None. For anything that spends it.

    `provider` is unique in this table, so there is no ordering question here --
    a provider has one key or it has none.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"select {_COLUMNS} from model_credentials "  # noqa: S608
                "where provider = %s and enabled",
                (provider,),
            )
            record = await cur.fetchone()

    return _row(record) if record else None
