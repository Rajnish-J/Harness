"""Credential verification.

One endpoint, and it is the only place in the backend that turns a stored
ciphertext into a usable token during Milestone 1. It reads from a Next.js-owned
table and writes nothing back — the caller records the verdict, keeping
`credentials` to a single writer (see app/db/credential_repo.py).

Like the workflow routes, this 503s rather than 500s when its prerequisites are
missing, because "no DATABASE_URL" and "no encryption key" are operator
configuration problems with a specific fix, not server faults.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.secrets import CredentialCryptoError
from app.db.credential_repo import get_credential
from app.integrations.github import GitHubError, validate_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["credentials"])


class CredentialTestResult(BaseModel):
    ok: bool
    username: str | None = None
    scopes: list[str] = []
    message: str


@router.post("/credentials/{credential_id}/test")
async def test_credential(
    credential_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> CredentialTestResult:
    """Does this token actually work?

    A rejected token is a 200 with `ok: false`, not an HTTP error: "your PAT
    expired" is a verdict the UI wants to display and store, not a failed
    request. Only the harness being unable to *perform* the check — no database,
    no key, unknown credential — is an error status.
    """
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so credentials cannot be read.",
        )

    row = await get_credential(pool, credential_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Credential not found.")

    try:
        token = row.decrypt(settings)
    except CredentialCryptoError as exc:
        # The stored bytes are fine; the key is wrong or missing. Say so plainly
        # rather than letting it read as a rejected token.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if row.provider != "github":
        return CredentialTestResult(
            ok=False,
            message=(
                f"Testing {row.provider!r} credentials is not implemented yet. "
                "The token is stored and encrypted, but nothing verifies it."
            ),
        )

    try:
        identity = await validate_token(token)
    except GitHubError as exc:
        logger.info("credential %s failed validation: %s", credential_id, exc)
        return CredentialTestResult(ok=False, message=str(exc))
    finally:
        # Not security, just hygiene: keeps the plaintext out of any traceback
        # rendered from this frame.
        del token

    note = (
        "Fine-grained token — GitHub does not report its permissions, so scope "
        "problems will only surface when an action needs one."
        if identity.fine_grained
        else f"Scopes: {', '.join(identity.scopes)}."
    )

    return CredentialTestResult(
        ok=True,
        username=identity.username,
        scopes=identity.scopes,
        message=f"Authenticated as {identity.username}. {note}",
    )
