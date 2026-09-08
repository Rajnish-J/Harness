"""`list_imports` and `find_importers`: the dependency edges between files.

find_importers is the one to reach for before moving or renaming a module. It
answers "what breaks if I move this file" directly, which grep only approximates
-- grep for `base` matches every English sentence containing the word, while
this matches import statements alone.

list_imports earns its place over grep by resolving a dotted module back to a
file in the tree, so External and Local are actually distinguished rather than
guessed from a leading dot.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.codeintel._python_ast import PY_EXTS, iter_imports, parse_python
from app.agent.tools.codeintel._regex_scan import TS_EXTS
from app.agent.tools.search.search_tools import _iter_text_files
from app.core.workspace import resolve_safe_path, to_display_path

CODEINTEL_GROUP = "Code Intelligence"

#: `from "x"`, `require("x")`, `import("x")` -- one group, the quoted specifier.
_TS_IMPORT_RE = re.compile(
    r"""(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)"""
    r"""['"]([^'"]+)['"]"""
)


def _module_to_paths(module: str) -> list[str]:
    """Candidate file paths a dotted Python module could live at."""
    parts = module.split(".")
    return ["/".join(parts) + ".py", "/".join(parts) + "/__init__.py"]


def _is_local_python(module: str, workspace_root: Path) -> bool:
    if module.startswith("."):
        return True
    return any((workspace_root / candidate).exists() for candidate in _module_to_paths(module))


def _ts_imports(source: str) -> list[tuple[int, str, str]]:
    found: list[tuple[int, str, str]] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        for match in _TS_IMPORT_RE.finditer(line):
            found.append((lineno, match.group(1), line.strip()))
    return found


def list_imports(
    path: str, *, workspace_root: Path, max_file_bytes: int, **_ignored: object
) -> str:
    target = resolve_safe_path(path, workspace_root)
    display = to_display_path(target, workspace_root)

    if not target.exists():
        raise ToolExecutionError(f"No such file: {display}")
    if target.is_dir():
        raise ToolExecutionError(f"{display} is a directory, not a file.")
    if target.stat().st_size > max_file_bytes:
        raise ToolExecutionError(f"{display} is over the {max_file_bytes}-byte read limit.")

    try:
        source = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ToolExecutionError(f"{display} is not valid UTF-8 text: {exc}") from exc

    suffix = target.suffix.lower()
    local: list[str] = []
    external: list[str] = []

    if suffix in PY_EXTS:
        root = workspace_root.resolve()
        for lineno, module, statement in iter_imports(parse_python(source, display)):
            row = f"{lineno:>5}: {statement}"
            (local if _is_local_python(module, root) else external).append(row)
    elif suffix in TS_EXTS:
        for lineno, specifier, statement in _ts_imports(source):
            row = f"{lineno:>5}: {statement}"
            # In TS/JS a leading . or / is the whole signal; bare specifiers are
            # package names by construction.
            is_local = specifier.startswith((".", "/")) or specifier.startswith("@/")
            (local if is_local else external).append(row)
    else:
        supported = ", ".join(sorted(PY_EXTS | TS_EXTS))
        raise ToolExecutionError(
            f"{display}: cannot list imports for {suffix or 'this file type'}. "
            f"Supported: {supported}."
        )

    if not local and not external:
        return f"{display} imports nothing."

    sections = [f"Imports in {display}:"]
    if local:
        sections.append("\nLocal (resolves inside this workspace):")
        sections.extend(local)
    if external:
        sections.append("\nExternal (a dependency, or unresolved in-tree):")
        sections.extend(external)
    return "\n".join(sections)


def _candidates(module: str) -> set[str]:
    """The forms an import of `module` could plausibly be written in."""
    cleaned = module.strip().strip("/")
    for ext in (".py", ".ts", ".tsx", ".js", ".jsx"):
        if cleaned.endswith(ext):
            cleaned = cleaned[: -len(ext)]
    dotted = cleaned.replace("/", ".")
    slashed = cleaned.replace(".", "/")
    return {cleaned, dotted, slashed, dotted.split(".")[-1]}


def find_importers(
    module: str,
    path: str = ".",
    max_results: int = 100,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    wanted = module.strip()
    if not wanted:
        raise ToolExecutionError("module must be a non-empty module or file path.")

    root = resolve_safe_path(path or ".", workspace_root)
    if not root.exists():
        raise ToolExecutionError(f"No such path: {path}")
    display_root = to_display_path(root, workspace_root)

    candidates = _candidates(wanted)
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
                found = list(iter_imports(parse_python(source, display)))
            except ToolExecutionError:
                continue
            entries = [(lineno, imported, stmt) for lineno, imported, stmt in found]
        else:
            entries = _ts_imports(source)

        for lineno, imported, statement in entries:
            normalized = imported.strip().lstrip(".").strip("/")
            for ext in (".py", ".ts", ".tsx", ".js", ".jsx"):
                if normalized.endswith(ext):
                    normalized = normalized[: -len(ext)]
            forms = {normalized, normalized.replace("/", "."), normalized.replace(".", "/")}
            if forms & candidates:
                hits.append(f"{display}:{lineno}: {statement}")
                break_outer = len(hits) >= max_results
                if break_outer:
                    break
        if len(hits) >= max_results:
            break

    if not hits:
        return (
            f"Nothing under {display_root} imports {wanted!r}. Note this matches "
            "import statements only -- a module reached dynamically (importlib, "
            "a bare require built at runtime) will not appear."
        )

    return "\n".join([*hits, "", f"{len(hits)} importer(s) of {wanted!r}."])


IMPORTS_TOOLS: list[Tool] = [
    Tool(
        name="list_imports",
        description=(
            "List what one file imports, split into Local (resolves to a file "
            "inside this workspace) and External (a dependency, or something "
            "that does not resolve in-tree). Python imports are read from the "
            "AST and dotted modules are resolved against the tree; "
            "TypeScript/JavaScript specifiers are matched by regex."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to the workspace root.",
                }
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        run=list_imports,
        group=CODEINTEL_GROUP,
    ),
    Tool(
        name="find_importers",
        description=(
            "Find every file that imports a given module. Use this before moving, "
            "renaming or deleting a module: it answers what will break, and it is "
            "far more precise than grepping the module's name, which also matches "
            "prose. Matches import statements only, so a module loaded dynamically "
            "(importlib, a runtime-built require) will not show up."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "module": {
                    "type": "string",
                    "description": (
                        "Module path or file path, e.g. 'app.agent.tools.base' or "
                        "'components/chat/ChatWindow'."
                    ),
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search under. Defaults to the workspace root.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum importers to return. Defaults to 100.",
                },
            },
            "required": ["module"],
            "additionalProperties": False,
        },
        run=find_importers,
        group=CODEINTEL_GROUP,
    ),
]
