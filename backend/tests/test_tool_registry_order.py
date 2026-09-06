"""Invariants that hold for the whole tool registry, whatever is in it.

The order test is the load-bearing one. A stable tool order keeps the LLM
request prefix cacheable (see the comment in app/agent/tools/registry.py), so
tools are strictly APPENDED to ALL_TOOLS -- never inserted, never reordered.
That rule is invisible in a diff: appending a tool to GIT_TOOLS instead of to
the end of ALL_TOOLS looks tidier and silently shifts every tool after it.
Pinning the known-good prefix by name is what makes the mistake loud.
"""

import inspect

from app.agent.tools.registry import ALL_TOOLS

#: The registry as it stood before the coding-tool expansion, in order. Every
#: name here must keep its exact index forever. Adding to this list is only
#: correct when the new tools were genuinely appended at the end.
PRE_EXISTING_ORDER = [
    # FILE_TOOLS
    "read_file",
    "write_file",
    "list_directory",
    "edit_file",
    "delete_file",
    "move_file",
    "copy_file",
    "make_directory",
    # SEARCH_TOOLS
    "search_files",
    "glob_files",
    "file_exists",
    "diff_files",
    # SHELL_TOOLS
    "run_command",
    "run_tests",
    "run_lint",
    "run_build",
    # GIT_TOOLS
    "git_status",
    "git_diff",
    "git_log",
    "git_add",
    "git_commit",
    "git_branch",
    "git_show",
    # MEMORY_TOOLS
    "remember",
    # CHAT_TOOLS
    "list_project_chats",
    "read_project_chat",
]


def test_pre_existing_tools_keep_their_exact_positions():
    names = [tool.name for tool in ALL_TOOLS]
    assert names[: len(PRE_EXISTING_ORDER)] == PRE_EXISTING_ORDER


def test_tool_names_are_unique():
    names = [tool.name for tool in ALL_TOOLS]
    assert len(names) == len(set(names))


def test_every_tool_has_a_group():
    for tool in ALL_TOOLS:
        assert tool.group and tool.group.strip(), tool.name


def test_every_schema_is_a_closed_object():
    """Providers differ on how they treat an open schema; the registry does not."""
    for tool in ALL_TOOLS:
        assert tool.input_schema.get("type") == "object", tool.name
        assert tool.input_schema.get("additionalProperties") is False, tool.name
        assert isinstance(tool.input_schema.get("properties"), dict), tool.name


def test_every_required_property_is_declared():
    for tool in ALL_TOOLS:
        properties = tool.input_schema.get("properties", {})
        for name in tool.input_schema.get("required", []):
            assert name in properties, f"{tool.name}: required {name!r} is not a property"


def test_every_tool_absorbs_the_loops_injected_kwargs():
    """_dispatch_tool passes workspace_root, pool, executor and friends to every
    tool it calls. A tool without **kwargs raises TypeError on its first real
    call; this catches it at import time instead."""
    for tool in ALL_TOOLS:
        parameters = inspect.signature(tool.run).parameters.values()
        assert any(p.kind is p.VAR_KEYWORD for p in parameters), tool.name
