"""Shared SSE plumbing for the chat and workflow streams."""

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    # Tells nginx and friends not to buffer the stream into uselessness.
    "X-Accel-Buffering": "no",
}
