from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

StopReason = Literal["end_turn", "tool_use", "max_tokens", "refusal", "error"]

# Sentinel key used when a provider hands us tool arguments we couldn't decode.
PARSE_ERROR_KEY = "_parse_error"


@dataclass
class ToolCallRequest:
    """One tool invocation the model asked for."""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)

    @property
    def parse_error(self) -> str | None:
        return self.arguments.get(PARSE_ERROR_KEY)


@dataclass
class ToolResult:
    content: str
    is_error: bool = False


@dataclass
class LLMTurn:
    """One assistant turn, normalized across providers."""

    text: str | None
    tool_calls: list[ToolCallRequest]
    stop_reason: StopReason
    # Provider-native representation of this turn, kept so the client can
    # append it back to history without losing tool_use/thinking blocks.
    raw: Any = None
    refusal_detail: str | None = None
    # {"input_tokens": int, "output_tokens": int}, normalized across providers.
    # None when the provider response omitted usage (rare, but seen on some
    # SDK error/edge-case response shapes).
    usage: dict[str, int] | None = None


@runtime_checkable
class LLMClient(Protocol):
    """Provider-agnostic surface the agent loop talks to.

    Deliberately *not* a normalized message format. Each implementation owns
    its own on-the-wire history shape and mutates the history list in place;
    the loop only ever sees LLMTurn / ToolCallRequest / ToolResult. That is
    what keeps `loop.py` free of `if provider == ...` branches, despite
    Anthropic and OpenAI disagreeing about nearly every detail of tool
    turn-taking.
    """

    provider: str

    def user_message(self, text: str) -> Any:
        """Build a provider-native user message to append to history."""
        ...

    async def send(
        self,
        history: list[Any],
        tools: list[dict[str, Any]],
        system: str,
    ) -> LLMTurn:
        ...

    def append_assistant_turn(self, history: list[Any], turn: LLMTurn) -> None:
        ...

    def append_tool_results(
        self,
        history: list[Any],
        results: list[tuple[ToolCallRequest, ToolResult]],
    ) -> None:
        ...

    def tool_schemas(self, tools: list[Any]) -> list[dict[str, Any]]:
        """Render the shared tool registry into this provider's schema dialect."""
        ...
