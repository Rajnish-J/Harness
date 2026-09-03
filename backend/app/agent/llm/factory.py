from app.agent.llm.base import LLMClient
from app.core.config import Settings


def client_for(
    provider: str,
    api_key: str,
    model: str,
    base_url: str | None = None,
) -> LLMClient:
    """Build a provider client from an explicit key and model.

    The credential-driven entry point: app/agent/llm/resolver.py resolves which
    provider and which key a turn needs, and this turns that answer into a
    client. Imports are function-local so a deployment that only ever uses one
    provider never pays to import the other two SDKs.
    """
    if provider == "anthropic":
        from app.agent.llm.anthropic_client import AnthropicClient

        return AnthropicClient(api_key=api_key, model=model)

    if provider == "openai":
        from app.agent.llm.openai_client import OpenAIClient

        return OpenAIClient(api_key=api_key, model=model)

    if provider == "groq":
        from app.agent.llm.groq_client import GroqClient

        return GroqClient(api_key=api_key, model=model, base_url=base_url)

    raise ValueError(f"Unsupported LLM provider: {provider!r}")


def get_llm_client(settings: Settings) -> LLMClient:
    """Build a client from the environment alone.

    The pre-credentials path, kept for callers that have no database handle and
    no per-turn model to honour. Unlike before, this can now fail on a missing
    key: Settings no longer refuses to boot without one, because keys live in the
    database and requiring an `.env` copy would make a fresh install unbootable.
    """
    api_key = settings.env_key_for(settings.llm_provider)
    if not api_key:
        raise ValueError(
            f"No API key for {settings.llm_provider}. Add one under "
            "Credentials → Models, or set it in backend/.env."
        )

    model = settings.env_model_for(settings.llm_provider)
    if not model:
        raise ValueError(
            f"No model configured for {settings.llm_provider}. "
            f"Set {settings.llm_provider.upper()}_MODEL in backend/.env."
        )

    return client_for(settings.llm_provider, api_key=api_key, model=model)
