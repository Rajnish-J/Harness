"""`find_definition` and `find_references`: locating a name across the tree.

These two make a deliberately uneven promise, and the difference matters.

find_definition answers "where is this declared", which for Python the AST
answers exactly. find_references answers "what mentions this", which nothing
short of full type inference can answer exactly -- so it does not pretend to.
It is a word-boundary text match, in every language including Python, with the
Python hits labelled import/def/call from that file's own AST. That labelling
is derived, not guessed, and it is the honest limit of what is cheap here.

The distinction is repeated in the tool descriptions, in the output footer and
in the system prompt, because a model that treats an incomplete reference list
as complete will rename a symbol and leave call sites broken.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.codeintel._python_ast import (
    PY_EXTS,
    classify_lines,
    iter_definitions,
    parse_python,
)
from app.agent.tools.codeintel._regex_scan import TS_EXTS, scan_definitions
from app.agent.tools.search.search_tools import _iter_text_files
from app.core.workspace import resolve_safe_path, to_display_path

CODEINTEL_GROUP = "Code Intelligence"

TEXTUAL_FOOTER = (
    "Matched textually on word boundaries, not resolved. Two different things "
    "with the same name look identical here, matches inside comments and "
    "strings are included, and references reached through an alias, a "
    "re-export or an attribute on a variable are missed."
)


def _resolve_root(path: str, workspace_root: Path) -> tuple[Path, str]:
    root = resolve_safe_path(path or ".", workspace_root)
    if not root.exists():
        raise ToolExecutionError(f"No such path: {path}")
    return root, to_display_path(root, workspace_root)


def find_definition(
    symbol: str,
    path: str = ".",
    max_results: int = 50,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    wanted = symbol.strip()
    if not wanted:
        raise ToolExecutionError("symbol must be a non-empty name.")

    root, display_root = _resolve_root(path, workspace_root)
    hits: list[str] = []

    for file_path in _iter_text_files(root, max_file_bytes):
        suffix = file_path.suffix.lower()
        if suffix not in PY_EXTS and suffix not in TS_EXTS:
            continue
        try:
            source = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        display = to_display_path(file_path, workspace_root)

        if suffix in PY_EXTS:
            try:
                tree = parse_python(source, display)
            except ToolExecutionError:
                # One unparseable file must not fail the whole search.
                continue
            for definition in iter_definitions(tree):
                if definition.name == wanted or definition.qualname == wanted:
                    hits.append(
                        f"{display}:{definition.lineno}: {definition.kind} "
                        f"{definition.qualname}  -- {definition.signature}"
                    )
        else:
            for definition in scan_definitions(source):
                if definition.name == wanted:
                    hits.append(
                        f"{display}:{definition.lineno}: {definition.kind} "
                        f"{definition.name}  -- {definition.text}"
                    )

        if len(hits) >= max_results:
            break

    if not hits:
        return (
            f"No definition of {wanted!r} found under {display_root}. It may be "
            "imported from a dependency, defined dynamically, or written in a "
            "language this tool does not parse."
        )

    trimmed = hits[:max_results]
    footer = (
        f"{len(trimmed)} definition(s). Python results are AST-exact; "
        "TypeScript/JavaScript results are regex heuristics."
    )
    return "\n".join([*trimmed, "", footer])


def find_references(
    symbol: str,
    path: str = ".",
    max_results: int = 100,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    wanted = symbol.strip()
    if not wanted:
        raise ToolExecutionError("symbol must be a non-empty name.")

    root, display_root = _resolve_root(path, workspace_root)
    pattern = re.compile(rf"\b{re.escape(wanted)}\b")
    hits: list[str] = []

    for file_path in _iter_text_files(root, max_file_bytes):
        try:
            source = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if not pattern.search(source):
            continue

        display = to_display_path(file_path, workspace_root)
        labels: dict[int, str] = {}
        if file_path.suffix.lower() in PY_EXTS:
            try:
                labels = classify_lines(parse_python(source, display), wanted)
            except ToolExecutionError:
                labels = {}

        for lineno, line in enumerate(source.splitlines(), start=1):
            if not pattern.search(line):
                continue
            label = labels.get(lineno, "")
            hits.append(f"{display}:{lineno}: {label:<7} {line.strip()}")
            if len(hits) >= max_results:
                break
        if len(hits) >= max_results:
            break

    if not hits:
        return f"No textual references to {wanted!r} found under {display_root}."

    trimmed = hits[:max_results]
    more = " (truncated)" if len(hits) >= max_results else ""
    return "\n".join(
        [*trimmed, "", f"{len(trimmed)} reference(s){more}. {TEXTUAL_FOOTER}"]
    )


REFS_TOOLS: list[Tool] = [
    Tool(
        name="find_definition",
        description=(
            "Find where a name is declared -- a function, class, method, "
            "interface or type. Python is parsed with a real AST and those "
            "results are exact. TypeScript and JavaScript use regex heuristics "
            "and may miss unconventional declarations. This finds declarations "
            "only; it does not resolve what a name refers to at a given call "
            "site, since that needs type inference this does not do."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "The name to find the declaration of.",
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search under. Defaults to the workspace root.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum declarations to return. Defaults to 50.",
                },
            },
            "required": ["symbol"],
            "additionalProperties": False,
        },
        run=find_definition,
        group=CODEINTEL_GROUP,
    ),
    Tool(
        name="find_references",
        description=(
            "Find everything that mentions a name. This is a smarter grep, not a "
            "resolver: it matches text on word boundaries, so it cannot tell two "
            "different things with the same name apart, it matches inside "
            "comments and strings, and it misses references reached through an "
            "alias, a re-export, or attribute access on a variable. Python hits "
            "are additionally labelled import/def/call from that file's AST. "
            "Before you change anything this reports, read the file and confirm."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "The name to look for."},
                "path": {
                    "type": "string",
                    "description": "Directory to search under. Defaults to the workspace root.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum references to return. Defaults to 100.",
                },
            },
            "required": ["symbol"],
            "additionalProperties": False,
        },
        run=find_references,
        group=CODEINTEL_GROUP,
    ),
]
