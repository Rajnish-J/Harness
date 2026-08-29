"""The two credential ciphers must agree byte for byte.

Next.js encrypts a token (frontend/lib/server/crypto.ts) and this side decrypts
it, so a format drift between the two would not fail at build time or in either
language's own round-trip test — it would fail the first time someone tried to
clone a private repo, with a corrupt-looking token and no obvious cause.

The pinned blob below was produced by the TypeScript implementation. If a change
to either file breaks this test, the two have drifted and the ciphertext already
in the database is what decides which one is wrong.
"""

import pytest

from app.core.config import Settings
from app.core.secrets import (
    CredentialCryptoError,
    decrypt_secret,
    encrypt_secret,
    mask,
)

# Test-only key. Base64 of 32 bytes, the same shape a real deployment uses.
KEY = "d6f9PAbN8SM7duU2+xs9sKuiAEirD950leZ6h/Dt8g0="

# Produced by frontend/lib/server/crypto.ts encryptSecret() under KEY.
NODE_CIPHERTEXT = (
    "v1.Jwch0jv47GHegjBx.2Li5BtUsMStJkmENTGhAJAACywWx2Df3N2DfSY2OFVMRtDiUaerrpnc"
)
NODE_PLAINTEXT = "ghp_exampleTokenValue1234"


@pytest.fixture
def settings() -> Settings:
    return Settings(credentials_encryption_key=KEY)


def test_decrypts_a_ciphertext_produced_by_typescript(settings: Settings) -> None:
    """The whole point of this file."""
    assert decrypt_secret(NODE_CIPHERTEXT, settings) == NODE_PLAINTEXT


def test_round_trip(settings: Settings) -> None:
    token = "github_pat_11ABCDEFG_someLongOpaqueValue"
    assert decrypt_secret(encrypt_secret(token, settings), settings) == token


def test_nonce_is_fresh_per_encryption(settings: Settings) -> None:
    """Reusing a nonce under one key breaks GCM outright, so this is not style."""
    first = encrypt_secret("same-token", settings)
    second = encrypt_secret("same-token", settings)
    assert first != second
    assert decrypt_secret(first, settings) == decrypt_secret(second, settings)


def test_format_is_three_dotted_parts(settings: Settings) -> None:
    version, nonce, payload = encrypt_secret("token", settings).split(".")
    assert version == "v1"
    assert nonce and payload


def test_wrong_key_is_a_clear_error() -> None:
    other = Settings(credentials_encryption_key="A" * 42 + "o=")
    with pytest.raises(CredentialCryptoError) as excinfo:
        decrypt_secret(NODE_CIPHERTEXT, other)
    # The operator needs to be told what to do, not shown an InvalidTag.
    assert "CREDENTIALS_ENCRYPTION_KEY" in str(excinfo.value)


def test_missing_key_is_a_clear_error() -> None:
    with pytest.raises(CredentialCryptoError) as excinfo:
        encrypt_secret("token", Settings(credentials_encryption_key=None))
    assert "CREDENTIALS_ENCRYPTION_KEY is not set" in str(excinfo.value)


def test_key_of_wrong_length_is_rejected() -> None:
    short = Settings(credentials_encryption_key="c2hvcnQ=")  # b"short"
    with pytest.raises(CredentialCryptoError) as excinfo:
        encrypt_secret("token", short)
    assert "32 bytes" in str(excinfo.value)


@pytest.mark.parametrize(
    "blob",
    [
        "not-a-blob",
        "v1.onlytwo",
        "v2.Jwch0jv47GHegjBx.2Li5BtUsMStJkmENTGhAJAACywWx2Df3N2DfSY2OFVMRtDiUaerrpnc",
        "v1.dG9vc2hvcnQ.2Li5BtUsMStJkmENTGhAJAACywWx2Df3N2DfSY2OFVMRtDiUaerrpnc",
    ],
)
def test_malformed_blobs_are_rejected(blob: str, settings: Settings) -> None:
    with pytest.raises(CredentialCryptoError):
        decrypt_secret(blob, settings)


def test_empty_secret_is_refused(settings: Settings) -> None:
    with pytest.raises(CredentialCryptoError):
        encrypt_secret("", settings)


def test_mask_never_reveals_the_body() -> None:
    assert mask("ghp_exampleTokenValue1234") == "••••1234"
    assert mask("ab") == "••••"
