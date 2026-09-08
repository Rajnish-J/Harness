"""Code intelligence tools, dispatched the way the loop dispatches them.

Everything goes through _dispatch_tool rather than calling the functions
directly, so the loop's kwarg injection is exercised too -- a tool that forgot
**_ignored, or wanted a setting nobody passes, fails here rather than on its
first real call.
"""

import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import get_settings

TOOLS_BY_NAME = {tool.name: tool for tool in ALL_TOOLS}

PY_SAMPLE = '''"""Module docstring."""

import os
from pathlib import Path


def top_level(a: int, b: str = "x") -> bool:
    """Does a thing."""
    return bool(a)


class Widget:
    """A widget."""

    # This comment explains render.
    @property
    def render(self) -> str:
        return "widget"

    async def refresh(self) -> None:
        top_level(1)


def caller():
    w = Widget()
    return w.render
'''

TS_SAMPLE = """export function greet(name: string) {
  const tricky = "a } brace in a string";  // and a } in a comment
  return `hello ${name} ${tricky}`;
}

export class Panel {
  open(): void {
    return;
  }
}

export const handler = async (event: Event) => {
  return event;
};

export interface Shape {
  kind: string;
}

export type Id = string;
"""


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, settings):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings, TOOLS_BY_NAME
    )


@pytest.fixture
def sample_tree(tmp_path):
    (tmp_path / "sample.py").write_text(PY_SAMPLE, encoding="utf-8")
    (tmp_path / "sample.ts").write_text(TS_SAMPLE, encoding="utf-8")
    return tmp_path


# ---------------------------------------------------------------- code_outline


async def test_outline_finds_python_definitions_with_qualnames(settings, sample_tree):
    result = await dispatch("code_outline", {"path": "sample.py"}, settings)

    assert not result.is_error
    assert "python, ast" in result.content
    assert "top_level" in result.content
    assert "Widget.render" in result.content
    assert "Widget.refresh" in result.content
    # A method is reported as a method, not a bare function.
    assert "async method" in result.content


async def test_outline_finds_typescript_declarations(settings, sample_tree):
    result = await dispatch("code_outline", {"path": "sample.ts"}, settings)

    assert not result.is_error
    for name in ("greet", "Panel", "handler", "Shape", "Id"):
        assert name in result.content


async def test_typescript_outline_carries_its_own_caveat(settings, sample_tree):
    """The limit must travel with the answer, not live only in the description."""
    result = await dispatch("code_outline", {"path": "sample.ts"}, settings)

    assert "regex heuristic" in result.content


async def test_outline_names_the_line_of_a_syntax_error(settings, tmp_path):
    (tmp_path / "broken.py").write_text("def oops(\n", encoding="utf-8")

    result = await dispatch("code_outline", {"path": "broken.py"}, settings)

    assert result.is_error
    assert "not parseable Python" in result.content


async def test_outline_refuses_an_unsupported_extension(settings, tmp_path):
    (tmp_path / "notes.rb").write_text("def x; end\n", encoding="utf-8")

    result = await dispatch("code_outline", {"path": "notes.rb"}, settings)

    assert result.is_error
    assert ".py" in result.content


async def test_outline_refuses_a_path_outside_the_sandbox(settings, sample_tree):
    result = await dispatch("code_outline", {"path": "../outside.py"}, settings)

    assert result.is_error
    assert "workspace" in result.content.lower()


# ----------------------------------------------------------------- read_symbol


async def test_read_symbol_includes_decorator_and_leading_comment(settings, sample_tree):
    result = await dispatch(
        "read_symbol", {"path": "sample.py", "symbol": "Widget.render"}, settings
    )

    assert not result.is_error
    assert "@property" in result.content
    assert "This comment explains render." in result.content
    # Line-numbered, so the model can cite file:line from what it read.
    assert "|" in result.content


async def test_read_symbol_suggests_close_matches_on_a_miss(settings, sample_tree):
    result = await dispatch(
        "read_symbol", {"path": "sample.py", "symbol": "top_leval"}, settings
    )

    assert result.is_error
    assert "top_level" in result.content


async def test_read_symbol_brace_matching_survives_strings_and_comments(
    settings, sample_tree
):
    """The reason find_block_end is a state machine and not a brace count."""
    result = await dispatch("read_symbol", {"path": "sample.ts", "symbol": "greet"}, settings)

    assert not result.is_error
    # The real closing brace is line 4; a naive counter would stop at line 2.
    assert "sample.ts:1-4" in result.content
    assert "return `hello" in result.content


async def test_read_symbol_reads_a_class_body(settings, sample_tree):
    result = await dispatch("read_symbol", {"path": "sample.py", "symbol": "Widget"}, settings)

    assert not result.is_error
    assert "class Widget" in result.content
    assert "async def refresh" in result.content


# ------------------------------------------------------- find_definition/refs


async def test_find_definition_locates_a_python_function(settings, sample_tree):
    result = await dispatch("find_definition", {"symbol": "top_level"}, settings)

    assert not result.is_error
    assert "sample.py:7" in result.content


async def test_find_definition_ignores_call_sites(settings, sample_tree):
    """A definition search must not report the line that merely calls it."""
    result = await dispatch("find_definition", {"symbol": "top_level"}, settings)

    assert result.content.count("sample.py:") == 1


async def test_find_definition_reports_a_clean_miss(settings, sample_tree):
    result = await dispatch("find_definition", {"symbol": "nonexistent_thing"}, settings)

    assert not result.is_error
    assert "No definition" in result.content


async def test_find_references_labels_python_hits(settings, sample_tree):
    result = await dispatch("find_references", {"symbol": "top_level"}, settings)

    assert not result.is_error
    assert "def" in result.content
    assert "call" in result.content


async def test_find_references_states_that_it_is_textual(settings, sample_tree):
    """The honesty disclaimer has to reach the model with the result."""
    result = await dispatch("find_references", {"symbol": "Widget"}, settings)

    assert "textually" in result.content


# ------------------------------------------------------------------- imports


async def test_list_imports_splits_local_from_external(settings, tmp_path):
    pkg = tmp_path / "app" / "core"
    pkg.mkdir(parents=True)
    (pkg / "helper.py").write_text("X = 1\n", encoding="utf-8")
    (tmp_path / "user.py").write_text(
        "import os\nfrom app.core.helper import X\n", encoding="utf-8"
    )

    result = await dispatch("list_imports", {"path": "user.py"}, settings)

    assert not result.is_error
    local, external = result.content.split("External")
    assert "app.core.helper" in local
    assert "import os" in external


async def test_list_imports_handles_typescript(settings, sample_tree):
    (sample_tree / "page.tsx").write_text(
        'import React from "react";\nimport { x } from "./local";\n', encoding="utf-8"
    )

    result = await dispatch("list_imports", {"path": "page.tsx"}, settings)

    assert not result.is_error
    local, external = result.content.split("External")
    assert "./local" in local
    assert "react" in external


async def test_find_importers_finds_a_dotted_module(settings, tmp_path):
    (tmp_path / "a.py").write_text("from app.core.helper import X\n", encoding="utf-8")
    (tmp_path / "b.py").write_text("import os\n", encoding="utf-8")

    result = await dispatch("find_importers", {"module": "app.core.helper"}, settings)

    assert not result.is_error
    assert "a.py:1" in result.content
    assert "b.py" not in result.content


async def test_find_importers_matches_a_slashed_path(settings, tmp_path):
    (tmp_path / "page.tsx").write_text(
        'import { Chat } from "components/chat/ChatWindow";\n', encoding="utf-8"
    )

    result = await dispatch(
        "find_importers", {"module": "components/chat/ChatWindow"}, settings
    )

    assert not result.is_error
    assert "page.tsx:1" in result.content


async def test_find_importers_says_so_when_nothing_imports_it(settings, sample_tree):
    result = await dispatch("find_importers", {"module": "app.nothing.here"}, settings)

    assert not result.is_error
    assert "Nothing under" in result.content


async def test_one_unparseable_file_does_not_fail_the_search(settings, sample_tree):
    """A broken file in the tree must not take the whole search down with it."""
    (sample_tree / "broken.py").write_text("def oops(\n", encoding="utf-8")

    result = await dispatch("find_definition", {"symbol": "top_level"}, settings)

    assert not result.is_error
    assert "sample.py:7" in result.content
