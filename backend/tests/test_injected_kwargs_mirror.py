"""Pin app/mcp/tools.py's LOOP_INJECTED_KWARGS to what _dispatch_tool injects.

The agent loop passes workspace_root, pool, executor and friends to every tool
it calls. Built-in tools absorb them with **_ignored; MCP tools cannot, because
their arguments go over a wire to another process, so the MCP wrapper strips
each name in LOOP_INJECTED_KWARGS before calling.

That makes the tuple a hand-maintained copy of an argument list in a different
file, which drifts the moment someone adds an injected kwarg. The last time it
drifted, an AsyncConnectionPool reached pydantic and blew up loudly. The next
time might not: a plain str or list serializes onto the wire perfectly happily
and just confuses the server.

So this test derives the expected set from the source of _dispatch_tool itself
rather than restating it. A hardcoded list here would need updating alongside
the very thing it is supposed to guard, which is no guard at all.
"""

import ast
import inspect

from app.agent.loop import _dispatch_tool
from app.mcp.tools import LOOP_INJECTED_KWARGS


def _injected_kwarg_names() -> set[str]:
    """The keywords _dispatch_tool passes to `tool.run(...)`, minus **call.arguments."""
    tree = ast.parse(inspect.cleandoc(inspect.getsource(_dispatch_tool)))

    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "run"
    ]
    assert len(calls) == 1, f"expected exactly one tool.run(...) call, found {len(calls)}"

    # kw.arg is None for the **call.arguments splat, which is the model's own
    # arguments rather than something the loop injects.
    return {kw.arg for kw in calls[0].keywords if kw.arg is not None}


def test_mcp_mirror_names_every_injected_kwarg():
    assert _injected_kwarg_names() == set(LOOP_INJECTED_KWARGS)


def test_mirror_has_no_duplicates():
    assert len(LOOP_INJECTED_KWARGS) == len(set(LOOP_INJECTED_KWARGS))


def test_every_injected_kwarg_is_a_real_setting():
    """Each injected name is either a Settings field or one of the
    loop-scoped extras, so a typo cannot quietly inject None forever."""
    from app.core.config import Settings

    # Resolved per turn rather than read from Settings. tool_reserve_names is
    # the tool router's held-back set, which only request_tools reads.
    loop_scoped = {
        "executor",
        "pool",
        "project_id",
        "session_id",
        "tool_reserve_names",
    }
    fields = set(Settings.model_fields)

    for name in LOOP_INJECTED_KWARGS:
        assert name in fields or name in loop_scoped, name
