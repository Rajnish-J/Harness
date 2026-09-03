"""Model credential verification.

The twin of app/api/credentials.py, for LLM provider keys rather than git-forge
PATs, and it follows the same three rules:

- It is the only place in the backend that turns a stored model-key ciphertext
  into a usable key outside of an actual turn.
- It reads from a Next.js-owned table and writes nothing back. The caller records
  the verdict, keeping `model_credentials` to a single writer.
- It 503s rather than 500s when its prerequisites are missing, because "no
  DATABASE_URL" and "no encryption key" are operator configuration problems with
  a specific fix, not server faults.

The check is a plain models-list call rather than a completion: it is free, it is
fast, and it answers exactly the question being asked -- can this key reach this
provider. A completion would additionally answer "is there quota", which sounds
better until you notice it bills the operator for pressing a button.
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.secrets import CredentialCryptoError
from app.db.model_credential_repo import get_model_credential

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["model-credentials"])

_TIMEOUT = httpx.Timeout(15.0)


class ModelCredentialTestResult(BaseModel):
    ok: bool
    #: What the provider says this key can reach. Display only.
    models: list[str] = []
    message: str


def _endpoint(provider: str, base_url: str | None) -> tuple[str, dict[str, str]]:
    """The models-list URL and the auth headers for a provider.

    Anthropic authenticates with `x-api-key` and requires a version header;
    the other two use a bearer token. Groq's surface is OpenAI-shaped, which is
    why the two share a branch here even though they do not share a client.
    """
    if provider == "anthropic":
        root = base_url or "https://api.anthropic.com"
        return f"{root.rstrip('/')}/v1/models", {
            "x-api-key": "",  # filled by the caller
            "anthropic-version": "2023-06-01",
        }
    if provider == "openai":
        root = base_url or "https://api.openai.com/v1"
        return f"{root.rstrip('/')}/models", {"Authorization": ""}
    if provider == "groq":
        root = base_url or "https://api.groq.com/openai/v1"
        return f"{root.rstrip('/')}/models", {"Authorization": ""}
    raise ValueError(f"Unsupported provider: {provider!r}")


def _describe(status: int, body: str) -> str:
    """A one-line reason a key was refused, in the provider's own terms.

    The body is included because the interesting distinctions live there and not
    in the status: a 400 that says "credit balance too low" and a 400 that says
    "unsupported parameter" need different actions from the operator.
    """
    snippet = body.strip().replace("\n", " ")[:300]
    if status == 401:
        return f"Key rejected (401). {snippet}"
    if status == 403:
        return f"Key lacks permission (403). {snippet}"
    if status == 404:
        return f"Endpoint not found (404) — check the base URL. {snippet}"
    if status == 429:
        return f"Rate limited or out of quota (429). {snippet}"
    if status >= 500:
        return f"Provider server error ({status}). Try again shortly."
    return f"Provider refused the request ({status}). {snippet}"


@router.post("/model-credentials/{credential_id}/test")
async def test_model_credential(
    credential_id: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ModelCredentialTestResult:
    """Does this key actually work?

    A rejected key is a 200 with `ok: false`, not an HTTP error: "your key
    expired" is a verdict the UI wants to display and store, not a failed
    request. Only the harness being unable to *perform* the check -- no database,
    no encryption key, unknown credential -- is an error status.
    """
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured, so credentials cannot be read.",
        )

    row = await get_model_credential(pool, credential_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Credential not found.")

    try:
        api_key = row.decrypt(settings)
    except CredentialCryptoError as exc:
        # The stored bytes are fine; the key is wrong or missing. Say so plainly
        # rather than letting it read as a rejected credential.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        url, headers = _endpoint(row.provider, row.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if "x-api-key" in headers:
        headers["x-api-key"] = api_key
    else:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.info("model credential %s could not be reached: %s", credential_id, exc)
        return ModelCredentialTestResult(
            ok=False,
            message=f"Could not reach {row.provider}. {exc}",
        )
    finally:
        # Not security, just hygiene: keeps the plaintext out of any traceback
        # rendered from this frame.
        del api_key, headers

    if response.status_code != 200:
        logger.info(
            "model credential %s rejected with %s", credential_id, response.status_code
        )
        return ModelCredentialTestResult(
            ok=False, message=_describe(response.status_code, response.text)
        )

    models = _model_ids(response)
    listed = f" {len(models)} models available." if models else ""
    return ModelCredentialTestResult(
        ok=True,
        models=models,
        message=f"Key accepted by {row.provider}.{listed}",
    )


def _model_ids(response: httpx.Response) -> list[str]:
    """Pull model ids out of a provider's list response.

    All three wrap the list in `{"data": [...]}` today. Parsing defensively
    anyway: this is a nice-to-have for the UI, and a provider changing its
    envelope should not turn a working key into a failed test.
    """
    try:
        payload = response.json()
    except ValueError:
        return []

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    ids = [
        entry["id"]
        for entry in data
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    ]
    return sorted(ids)
