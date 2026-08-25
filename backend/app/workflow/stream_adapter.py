"""Normalize whatever `graph.astream()` yields into (mode, payload).

Isolated in one function on purpose. LangGraph's yield shape is decided by a
branch on `version`, `subgraphs` and whether `stream_mode` is a list, so it is
pin-dependent. Verified empirically against langgraph 1.2.11:

    astream(stream_mode=["custom", "updates"])   ->  ("custom", {...}) 2-tuples
    astream(stream_mode="custom")                ->  {...} bare payload

If a future upgrade changes it, this is the only function that needs to move.
"""

from typing import Any

STREAM_MODES = ["custom", "updates"]


def normalize_chunk(chunk: Any) -> tuple[str, Any] | None:
    """Return (mode, payload), or None if the chunk isn't one we can use."""
    # The documented v2 dict form, in case a future version defaults to it.
    if isinstance(chunk, dict) and "type" in chunk and "data" in chunk:
        return str(chunk["type"]), chunk["data"]

    if isinstance(chunk, tuple):
        if len(chunk) == 2:
            mode, payload = chunk
            return str(mode), payload
        if len(chunk) == 3:
            # (namespace, mode, payload) — emitted when subgraphs=True.
            _, mode, payload = chunk
            return str(mode), payload

    return None
