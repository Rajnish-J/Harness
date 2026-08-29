from typing import Any

import anthropic

from app.agent.llm.base import LLMTurn, ToolCallRequest, ToolResult
from app.agent.tools.base import Tool


class AnthropicClient:
    """Messages API implementation of the LLMClient protocol.

    History shape: [{"role": "user"|"assistant", "content": str | [blocks]}].
    Tool results are batched into ONE user message, per the Messages API
    contract for parallel tool use.
    """

    provider = "anthropic"

    def __init__(self, api_key: str, model: str, max_tokens: int = 16000) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model
        self._max_tokens = max_tokens

    def tool_schemas(self, tools: list[Tool]) -> list[dict[str, Any]]:
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
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
        # `thinking` is intentionally omitted: on Claude Opus 5 that means
        # adaptive thinking (on by default), while older models simply run
        # without it. Passing it explicitly would break model portability.
        # `tools` is omitted rather than sent empty: chat mode passes no tools
        # at all, and the API rejects an empty array.
        response = await self._client.messages.create(
            model=self._model,
            max_tokens=self._max_tokens,
            system=system,
            tools=tools or anthropic.NOT_GIVEN,
            messages=history,
        )

        text_parts: list[str] = []
        tool_calls: list[ToolCallRequest] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                # block.input is already decoded by the SDK.
                tool_calls.append(
                    ToolCallRequest(
                        id=block.id,
                        name=block.name,
                        arguments=dict(block.input or {}),
                    )
                )

        refusal_detail = None
        if response.stop_reason == "refusal" and response.stop_details:
            refusal_detail = (
                f"{response.stop_details.category}: "
                f"{response.stop_details.explanation}"
            )

        stop_reason = response.stop_reason
        if stop_reason not in ("end_turn", "tool_use", "max_tokens", "refusal"):
            # e.g. stop_sequence / pause_turn — nothing to act on in this
            # milestone (no server tools, no stop sequences), so treat the
            # turn as finished rather than inventing a loop continuation.
            stop_reason = "end_turn"

        usage = None
        if response.usage is not None:
            usage = {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            }

        return LLMTurn(
            text="\n".join(text_parts).strip() or None,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            raw=response.content,
            refusal_detail=refusal_detail,
            usage=usage,
        )

    def append_assistant_turn(self, history: list[Any], turn: LLMTurn) -> None:
        # The FULL content list goes back, not just extracted text — dropping
        # tool_use (or thinking) blocks makes the next request 400.
        history.append({"role": "assistant", "content": turn.raw})

    def append_tool_results(
        self,
        history: list[Any],
        results: list[tuple[ToolCallRequest, ToolResult]],
    ) -> None:
        blocks = [
            {
                "type": "tool_result",
                "tool_use_id": call.id,
                "content": result.content,
                "is_error": result.is_error,
            }
            for call, result in results
        ]
        # All results in a single user message. Splitting them across several
        # messages teaches the model to stop making parallel tool calls.
        history.append({"role": "user", "content": blocks})
