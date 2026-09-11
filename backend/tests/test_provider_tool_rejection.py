"""When the provider refuses a tool call instead of letting the model recover.

The router narrows a turn's toolset, and that trade is only safe because the
model can widen it again mid-turn through request_tools. Providers disagree
about whether it ever gets the chance:

- Anthropic treats a call to an unadvertised tool as ONE bad call. The turn
  survives, the model reads the error, and it asks for the tool properly.
- Groq rejects the entire request with a 400. The turn dies on its first wrong
  guess, and the recovery the router's safety argument rests on never runs.

So the loop grants a refused tool that it was holding in reserve and retries,
which makes the two providers behave the same way. What these tests pin is the
shape of that grant: it recovers once, it only ever hands over something the
turn was already allowed to call, and it cannot spin.
"""

from typing import Any

import pytest

from app.agent.llm.base import LLMTurn, ToolCallRequest, ToolResult
from app.agent.loop import _unadvertised_tool_name, run_agent_loop
from app.agent.session import Session
from app.agent.tools.meta.request_tools import REQUEST_TOOLS_TOOL
from app.agent.tools.registry import TOOLS_BY_NAME
from app.core.config import get_settings


class BadRequestError(Exception):
    """Stands in for the provider SDK's 400.

    Matched by class NAME in the loop, so every SDK that spells it this way is
    handled without importing any of them.
    """


class RateLimitError(Exception):
    """A different 4xx, to prove the detector is not just matching on text."""


#: Groq's actual wording, copied from a failing turn rather than paraphrased --
#: the detector is a regex over provider prose, so a paraphrase would test the
#: wrong string.
GROQ_400 = (
    "Error code: 400 - {'error': {'message': \"Tool call validation failed: "
    "tool call validation failed: attempted to call tool "
    "'mcp__github__get_me' which was not in request.tools\", "
    "'type': 'invalid_request_error', 'code': 'tool_use_failed'}}"
)


def refusal(name: str) -> BadRequestError:
    return BadRequestError(GROQ_400.replace("mcp__github__get_me", name))


class FlakyClient:
    """Raises scripted exceptions, then replays scripted turns.

    `script` holds either exceptions to raise or turns to return, consumed in
    order, so "fails once then succeeds" and "fails every time" are the same
    harness.
    """

    provider = "groq"

    def __init__(self, script: list[Any]) -> None:
        self._script = list(script)
        self.sent_tools: list[list[dict[str, Any]]] = []

    def tool_schemas(self, tools: list[Any]) -> list[dict[str, Any]]:
        return [{"name": tool.name} for tool in tools]

    def user_message(self, text: str) -> dict[str, Any]:
        return {"role": "user", "content": text}

    async def send(self, history, tools, system) -> LLMTurn:
        self.sent_tools.append(tools)
        if not self._script:
            raise AssertionError("FlakyClient ran out of script")
        step = self._script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step

    def append_assistant_turn(self, history: list[Any], turn: LLMTurn) -> None:
        history.append({"role": "assistant", "turn": turn})

    def append_tool_results(
        self, history: list[Any], results: list[tuple[ToolCallRequest, ToolResult]]
    ) -> None:
        history.append({"role": "user", "results": results})


def answer(text: str) -> LLMTurn:
    return LLMTurn(text=text, tool_calls=[], stop_reason="end_turn")


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


@pytest.fixture
def session():
    return Session(session_id="s1", provider="groq")


ACTIVE = [TOOLS_BY_NAME["list_directory"], REQUEST_TOOLS_TOOL]
RESERVE = [TOOLS_BY_NAME["read_file"]]


def names_sent(client: FlakyClient, index: int) -> list[str]:
    return [schema["name"] for schema in client.sent_tools[index]]


async def collect(stream) -> list[Any]:
    return [event async for event in stream]


def kinds(events: list[Any]) -> list[str]:
    return [type(event).__name__ for event in events]


# --- the detector ---------------------------------------------------------


def test_the_refused_tool_is_read_out_of_the_provider_error():
    assert _unadvertised_tool_name(BadRequestError(GROQ_400)) == "mcp__github__get_me"


def test_another_error_class_carrying_the_same_text_is_not_a_refusal():
    """Only a 400 means "you may not call that". A 429 means "not now"."""
    assert _unadvertised_tool_name(RateLimitError(GROQ_400)) is None


@pytest.mark.parametrize(
    "message",
    [
        "Error code: 400 - context length exceeded",
        "Error code: 400 - {'error': {'message': 'invalid model'}}",
        "",
    ],
)
def test_an_unrelated_bad_request_is_not_a_refusal(message):
    assert _unadvertised_tool_name(BadRequestError(message)) is None


# --- the recovery ---------------------------------------------------------


async def test_a_refused_reserve_tool_is_granted_and_the_turn_survives(
    settings, session
):
    """The headline fix: a narrowed turn no longer dies on its first guess."""
    client = FlakyClient([refusal("read_file"), answer("Here you go.")])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="read something",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    assert "ErrorEvent" not in kinds(events)
    assert events[-1].reason == "end_turn"
    # The retry is what carries the grant: absent on the first call, present
    # on the second.
    assert "read_file" not in names_sent(client, 0)
    assert "read_file" in names_sent(client, 1)


async def test_the_granted_tool_is_appended_last(settings, session):
    """Tool order is the cacheable prompt prefix, so a grant appends."""
    client = FlakyClient([refusal("read_file"), answer("Done.")])

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="read something",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    before = names_sent(client, 0)
    after = names_sent(client, 1)
    assert after[: len(before)] == before
    assert after[-1] == "read_file"


async def test_the_grant_is_remembered_for_a_later_resume(settings, session):
    """A manual-mode approve replays the turn's toolset from the session.

    Without this the widened tool is dropped on resume and the model is refused
    all over again, one round trip later. The session has to be carrying a
    selection already for the grant to be recorded -- see _remember_widening,
    which deliberately declines to pin an unrouted turn to whatever it held.
    """
    session.selected_tool_names = [tool.name for tool in ACTIVE]
    session.reserve_tool_names = [tool.name for tool in RESERVE]
    client = FlakyClient([refusal("read_file"), answer("Done.")])

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="read something",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    assert "read_file" in (session.selected_tool_names or [])
    assert "read_file" not in (session.reserve_tool_names or [])


async def test_an_unrouted_turn_is_not_pinned_by_a_grant(settings, session):
    """The other half of that contract.

    A turn with no selection of its own must not gain one from a grant, or a
    full-registry conversation quietly becomes a narrowed one for good.
    """
    client = FlakyClient([refusal("read_file"), answer("Done.")])

    await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="read something",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    assert session.selected_tool_names is None


# --- the limits -----------------------------------------------------------


async def test_a_tool_that_was_never_held_back_is_not_conjured(settings, session):
    """The turn may only ever shrink.

    A name outside the reserve is a hallucination, a tool switched off on
    /tools, or a candidate from a server the user has not attached. Granting
    any of those would widen the turn past what it was allowed to call, so this
    fails the turn instead -- one call, no retry.
    """
    client = FlakyClient([refusal("mcp__github__get_me")])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="who am i",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    assert len(client.sent_tools) == 1
    errors = [e for e in events if type(e).__name__ == "ErrorEvent"]
    assert errors and errors[0].code == "bad_request"
    assert events[-1].reason == "error"


async def test_the_retry_happens_at_most_once(settings, session):
    """A provider that refuses no matter what must not buy calls forever."""
    client = FlakyClient([refusal("read_file"), refusal("read_file")])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="read something",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    assert len(client.sent_tools) == 2
    assert events[-1].reason == "error"


async def test_the_same_tool_is_never_granted_twice(settings, session):
    """Granting removes the name from the reserve, which is the real bound.

    A second refusal naming the tool just granted finds nothing left to hand
    over, so it fails rather than looping on a grant that changes nothing.
    """
    client = FlakyClient(
        [refusal("read_file"), refusal("read_file"), answer("unreachable")]
    )

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="read something",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    assert len(client.sent_tools) == 2
    assert events[-1].reason == "error"


async def test_an_ordinary_provider_failure_still_fails_the_turn(settings, session):
    """The recovery is narrow: it must not swallow real errors."""
    client = FlakyClient([BadRequestError("Error code: 400 - context too long")])

    events = await collect(
        run_agent_loop(
            session=session,
            llm_client=client,
            settings=settings,
            user_message="hello",
            tools=ACTIVE,
            tool_reserve=RESERVE,
        )
    )

    assert len(client.sent_tools) == 1
    assert events[-1].reason == "error"
