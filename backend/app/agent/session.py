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
            # Each provider's history is structurally different, so replaying one
            # through another client would fail deep inside the SDK.
            raise ProviderMismatchError(
                f"Session {session_id!r} was created with provider "
                f"{session.provider!r} but this turn runs on {provider!r}."
            )
        return session

    def switch_provider(self, session_id: str, provider: str) -> Session:
        """Re-home a session onto a different provider, dropping its history.

        Switching provider mid-conversation used to be a dead end: the composer
        could only ever offer one provider's models, so a mismatch meant a stale
        browser tab and "start a new chat" was a fair answer. Now that the model
        picker lists every provider with a registered key, switching is an
        ordinary thing to do and refusing the turn would be hostile.

        The history genuinely cannot come along -- the shapes do not convert --
        so it is dropped and the caller tells the user that plainly. Anything
        parked awaiting approval goes with it: those tool calls belong to the
        turn that is being abandoned.
        """
        session = Session(session_id=session_id, provider=provider)
        self._sessions[session_id] = session
        return session

    def reset(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None


session_store = SessionStore()
