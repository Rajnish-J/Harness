"""Turning a requested model id into a client that can run the turn.

This is the seam the Credentials page plugs into. Before it, "which provider am
I talking to" was answered once at boot by `LLM_PROVIDER` and could not change
without a restart; now it is answered per turn, from the keys the operator has
registered.

The resolution order is deliberate:

1. The requested model id decides the PROVIDER -- by catalog lookup, then by
   asking whether any credential claims it as an extra id. A turn asking for
   `llama-3.3-70b-versatile` is asking for Groq whatever `.env` says.
2. The provider decides the KEY -- database first, `.env` second.
3. No key for that provider is a `NoCredentialError`, which the chat route turns
   into an ordinary SSE error naming the fix, rather than a 500.

Step 1 is why an unknown model id falls back to `settings.llm_provider` rather
than failing: a preview id or a fine-tune the catalog has never heard of should
run against the configured provider, not be rejected for being new.
"""

import logging

from psycopg_pool import AsyncConnectionPool

from app.agent.llm.base import LLMClient
from app.agent.llm.catalog import (
    MODEL_CATALOG,
    ResolvedCredential,
    default_model,
    resolve_credentials,
)
from app.agent.llm.factory import client_for
from app.core.config import Settings
from app.core.secrets import CredentialCryptoError
from app.db.model_credential_repo import (
    ModelCredentialRow,
    get_enabled_model_credential,
    list_model_credentials,
)

logger = logging.getLogger(__name__)

#: Which model each provider runs when nothing names one. Only consulted for a
#: provider whose key came from the database, since an `.env` key brings its own
#: model setting along with it.
_PROVIDER_FALLBACK_MODEL = {
    "anthropic": "claude-opus-5",
    "openai": "gpt-4o",
    "groq": "llama-3.3-70b-versatile",
}


class NoCredentialError(Exception):
    """No usable key for the provider a turn needs."""


async def load_credentials(
    pool: AsyncConnectionPool | None, settings: Settings
) -> dict[str, ResolvedCredential]:
    """Every usable key, database over `.env`.

    A database that is unreachable degrades to the `.env` keys rather than
    failing the turn -- the same non-fatal posture MCP resolution takes. Chat
    predates the database in this codebase and must keep working without it.
    """
    rows: list[ModelCredentialRow] = []
    if pool is not None:
        try:
            rows = await list_model_credentials(pool)
        except Exception:  # noqa: BLE001 - degrade to env, never fail the turn
            logger.exception("Could not read model_credentials; falling back to .env")

    return resolve_credentials(settings, rows)


def provider_for_model(
    model_id: str | None,
    settings: Settings,
    credentials: dict[str, ResolvedCredential] | None = None,
) -> str:
    """Which provider serves this model id.

    Catalog first, then the operator's own extra ids, then the configured
    provider as a fallback for anything neither knows about.
    """
    if not model_id:
        return settings.llm_provider

    for model in MODEL_CATALOG:
        if model.id == model_id:
            return model.provider

    for credential in (credentials or {}).values():
        if model_id in credential.extra_models:
            return credential.provider

    return settings.llm_provider


async def client_for_turn(
    pool: AsyncConnectionPool | None,
    settings: Settings,
    model_id: str | None,
    credentials: dict[str, ResolvedCredential] | None = None,
) -> tuple[LLMClient, str]:
    """Build the client for one turn. Returns it with the model it will run.

    Raises NoCredentialError when the provider the turn needs has no key, and
    CredentialCryptoError when it has one that cannot be decrypted -- two
    different operator problems that deserve two different messages.
    """
    resolved = (
        credentials if credentials is not None else await load_credentials(pool, settings)
    )
    provider = provider_for_model(model_id, settings, resolved)
    credential = resolved.get(provider)

    if credential is None or not credential.enabled:
        raise NoCredentialError(
            f"No API key is configured for {provider}. Add one under "
            "Credentials → Models, or set it in backend/.env."
        )

    # The model the turn actually runs: what the composer asked for, else what
    # this deployment nominates, else the provider's own default.
    model = (
        model_id
        or default_model(settings, resolved)
        or settings.env_model_for(provider)
        or _PROVIDER_FALLBACK_MODEL.get(provider)
    )
    if not model:
        raise NoCredentialError(
            f"No model is configured for {provider}. Set one on the credential "
            "or in backend/.env."
        )

    api_key: str | None
    base_url: str | None = None

    if credential.source == "db":
        if pool is None:  # pragma: no cover - defensive; source is db only if read
            raise NoCredentialError(
                f"The {provider} key is stored in the database, which is not "
                "reachable right now."
            )
        row = await get_enabled_model_credential(pool, provider)
        if row is None:
            raise NoCredentialError(
                f"The {provider} key was removed or disabled while this turn was "
                "being prepared."
            )
        # Decrypted here and handed straight to the constructor: the plaintext
        # lives for the length of this call, never on a cached row object.
        try:
            api_key = row.decrypt(settings)
        except CredentialCryptoError:
            logger.exception("Could not decrypt the %s key", provider)
            raise
        base_url = row.base_url
    else:
        api_key = settings.env_key_for(provider)

    if not api_key:
        raise NoCredentialError(f"The {provider} key is registered but empty.")

    return client_for(provider, api_key=api_key, model=model, base_url=base_url), model
