import json
from typing import Any

from openai import NOT_GIVEN, AsyncOpenAI

from app.agent.llm.base import PARSE_ERROR_KEY, LLMTurn, ToolCallRequest, ToolResult
from app.agent.tools.base import Tool


class OpenAIClient:
    """Chat Completions implementation of the LLMClient protocol.

    Chat Completions (rather than the Responses API) because its turn shape —
    an assistant message carrying `tool_calls`, followed by one `tool` message
    per call — maps almost 1:1 onto Anthropic's turn-taking, which is what lets
    both providers sit behind one loop.

    History shape: [{"role": ..., "content": ..., "tool_calls": [...]}], with
    tool results as SEPARATE {"role": "tool"} messages — the main structural
    disagreement with Anthropic, absorbed entirely in append_tool_results.
    """

    provider = "openai"

    def __init__(self, api_key: str, model: str, max_tokens: int = 16000) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
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
        # Same reasoning as the Anthropic client: an empty `tools` array is a
        # 400, so chat mode omits the parameter entirely.
        response = await self._client.chat.completions.create(
            model=self._model,
            max_completion_tokens=self._max_tokens,
            messages=[{"role": "system", "content": system}, *history],
            tools=tools or NOT_GIVEN,
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

        usage = None
        if response.usage is not None:
            usage = {
                "input_tokens": response.usage.prompt_tokens,
                "output_tokens": response.usage.completion_tokens,
            }

        return LLMTurn(
            text=(message.content or "").strip() or None,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            raw=message,
            refusal_detail=(
                "content_filter" if choice.finish_reason == "content_filter" else None
            ),
            usage=usage,
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
        # One message per result — the inverse of Anthropic's single batched
        # user message. is_error has no wire representation here, so the error
        # is folded into the content the model reads.
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

    OpenAI hands tool arguments back as a JSON *string*, which means malformed
    JSON is a real possibility. Rather than crash the loop, tag it so the loop
    can hand the model back an error and let it correct itself.
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
