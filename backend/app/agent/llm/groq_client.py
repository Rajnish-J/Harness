import json
from typing import Any

from groq import AsyncGroq, omit

from app.agent.llm.base import PARSE_ERROR_KEY, LLMTurn, ToolCallRequest, ToolResult
from app.agent.tools.base import Tool


class GroqClient:
    """Groq implementation of the LLMClient protocol.

    Groq's SDK is generated from the same toolchain as OpenAI's and speaks the
    same Chat Completions dialect, so this is deliberately a close sibling of
    openai_client.py: an assistant message carrying `tool_calls`, followed by one
    `tool` message per result, and tool arguments arriving as a JSON *string*
    that has to be decoded defensively.

    It is a separate class rather than an `OpenAIClient(base_url=...)` because
    the two disagree in ways that would otherwise accumulate as branches inside
    one client: Groq's optional-parameter sentinel is `omit` rather than
    `NOT_GIVEN`, it namespaces most model ids with a `/`, and its roadmap for
    tool calling moves independently of OpenAI's. The duplication here is a few
    dozen lines; the alternative is a client that is subtly wrong for both.

    One thing that is NOT duplicated is error handling. Groq raises the same
    exception class names as both other SDKs (`AuthenticationError`,
    `RateLimitError`, `NotFoundError`, ...), so `_classify_llm_error` in
    app/agent/loop.py matches it on name with no change.
    """

    provider = "groq"

    def __init__(
        self,
        api_key: str,
        model: str,
        max_tokens: int = 16000,
        base_url: str | None = None,
    ) -> None:
        # base_url is passed only when set: handing the SDK None would override
        # its own default rather than fall back to it.
        self._client = (
            AsyncGroq(api_key=api_key, base_url=base_url)
            if base_url
            else AsyncGroq(api_key=api_key)
        )
        self._model = model
        self._max_tokens = max_tokens

    def tool_schemas(self, tools: list[Tool]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            }
            for tool in tools
        ]

    def user_message(self, text: str) -> dict[str, Any]:
        return {"role": "user", "content": text}

    async def send(
        self,
        history: list[Any],
        tools: list[dict[str, Any]],
        system: str,
    ) -> LLMTurn:
        # Same reasoning as the other two clients: an empty `tools` array is a
        # 400, so chat mode omits the parameter entirely. Groq spells the
        # "parameter not supplied" sentinel `omit`, not `NOT_GIVEN`.
        response = await self._client.chat.completions.create(
            model=self._model,
            max_completion_tokens=self._max_tokens,
            messages=[{"role": "system", "content": system}, *history],
            tools=tools or omit,
        )
        choice = response.choices[0]
        message = choice.message

        tool_calls: list[ToolCallRequest] = []
        for call in message.tool_calls or []:
            tool_calls.append(
                ToolCallRequest(
                    id=call.id,
                    name=call.function.name,
                    arguments=_decode_arguments(call.function.arguments),
                )
            )

        if choice.finish_reason == "tool_calls" or tool_calls:
            stop_reason = "tool_use"
        elif choice.finish_reason == "length":
            stop_reason = "max_tokens"
        elif choice.finish_reason == "content_filter":
            stop_reason = "refusal"
        else:
            stop_reason = "end_turn"

        return LLMTurn(
            text=(message.content or "").strip() or None,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            raw=message,
            refusal_detail=(
                "content_filter" if choice.finish_reason == "content_filter" else None
            ),
        )

    def append_assistant_turn(self, history: list[Any], turn: LLMTurn) -> None:
        message = turn.raw
        entry: dict[str, Any] = {
            "role": "assistant",
            "content": message.content,
        }
        if message.tool_calls:
            entry["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    },
                }
                for call in message.tool_calls
            ]
        history.append(entry)

    def append_tool_results(
        self,
        history: list[Any],
        results: list[tuple[ToolCallRequest, ToolResult]],
    ) -> None:
        # One message per result. is_error has no wire representation here, so
        # the error is folded into the content the model reads.
        for call, result in results:
            content = result.content
            if result.is_error:
                content = f"Error: {content}"
            history.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": content,
                }
            )


def _decode_arguments(raw: str | None) -> dict[str, Any]:
    """Decode a tool-call argument blob without ever raising.

    Tool arguments arrive as a JSON *string*, which means malformed JSON is a
    real possibility — more so here than with the frontier models, since the
    open-weights models Groq serves are weaker at emitting strict JSON. Rather
    than crash the loop, tag it so the loop can hand the model back an error and
    let it correct itself.
    """
    if not raw:
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        return {PARSE_ERROR_KEY: f"invalid JSON in tool arguments: {exc}"}
    if not isinstance(decoded, dict):
        return {PARSE_ERROR_KEY: f"expected a JSON object, got {type(decoded).__name__}"}
    return decoded
