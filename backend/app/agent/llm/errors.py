"""Typed failures from the LLM layer that the API surfaces with their own code.

Kept in its own module rather than on factory.py: both app/api/chat.py and
app/api/workflows.py need to catch these, and importing them from the factory
would drag the whole client-construction path into workflows' import graph
just to name an exception.
"""


class ProviderSDKMissingError(Exception):
    """A provider's SDK is pinned in requirements.txt but not installed here.

    Distinct from NoCredentialError (the operator has no key) and from
    CredentialCryptoError (the key cannot be read): nothing about the
    operator's data is wrong, the environment is just incomplete. The fix is a
    pip command, so the message names it -- and names the reason this failure
    is confusing, which is that testing a key never touches the SDK.
    """

    def __init__(self, provider: str, module: str) -> None:
        self.provider = provider
        self.module = module
        super().__init__(
            f"The {provider} SDK is not installed (no module named {module!r}), "
            f"so {provider} models cannot run. Install it with "
            f"`python -m pip install -r backend/requirements.txt` and restart "
            f"the backend. Testing the key under Credentials -> Models succeeds "
            f"regardless: that path uses raw HTTP, not the SDK."
        )
