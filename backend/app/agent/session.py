from dataclasses import dataclass, field
from typing import Any

from app.agent.llm.base import ToolCallRequest


class ProviderMismatchError(Exception):
    """A session's history can't be replayed through a different provider."""


@dataclass
class Session:
    session_id: str
    provider: str
    # Provider-native message list. Only the owning LLMClient understands it.
    history: list[Any] = field(default_factory=list)
    # Manual mode: tool calls the model asked for and the user has not yet
    # ruled on. The assistant turn holding them is ALREADY in `history`, so a
    # resume only has to append the results.
    pending: list[ToolCallRequest] | None = None


class SessionStore:
    """In-memory session storage.

    Deliberately not persisted: this milestone proves the loop, and Next.js
    owns durable state in a later one. A backend restart is meant to lose
    everything — that's the tell that nothing is secretly writing to disk.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get_or_create(self, session_id: str, provider: str) -> Session:
        session = self._sessions.get(session_id)
        if session is None:
            session = Session(session_id=session_id, provider=provider)
            self._sessions[session_id] = session
            return session

        if session.provider != provider:
            # Anthropic and OpenAI histories are structurally different, so
            # replaying one through the other client would fail deep inside
            # the SDK. Fail loudly and early instead.
            raise ProviderMismatchError(
                f"Session {session_id!r} was created with provider "
                f"{session.provider!r} but the server is now configured for "
                f"{provider!r}. Start a new chat."
            )
        return session

    def reset(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None


session_store = SessionStore()
