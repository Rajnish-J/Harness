from app.agent.llm.base import LLMClient
from app.core.config import Settings


def get_llm_client(settings: Settings) -> LLMClient:
    """Build the configured provider client.

    Credentials are validated in Settings, so by the time we get here the
    required key (and model, for OpenAI) is guaranteed present.
    """
    if settings.llm_provider == "anthropic":
        from app.agent.llm.anthropic_client import AnthropicClient

        return AnthropicClient(
            api_key=settings.anthropic_api_key,
            model=settings.anthropic_model,
        )

    if settings.llm_provider == "openai":
        from app.agent.llm.openai_client import OpenAIClient

        return OpenAIClient(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
        )

    raise ValueError(f"Unsupported LLM_PROVIDER: {settings.llm_provider!r}")
