"""`list_dependencies`: what this project declares it depends on.

Declared, not resolved. Lockfiles are deliberately not read: they are large,
machine-generated, and answer a different question ("what is installed") than
the one a coding agent usually has ("what may I import"). The description says
so, so the distinction reaches the model rather than living only here.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path, to_display_path

INSIGHT_GROUP = "Project Insight"


def _package_json(root: Path, include_dev: bool) -> list[str]:
    path = root / "package.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ToolExecutionError(f"package.json is not valid JSON: {exc}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise ToolExecutionError(f"Could not read package.json: {exc}") from exc

    sections = [("dependencies", "dependencies"), ("peerDependencies", "peerDependencies")]
    if include_dev:
        sections.insert(1, ("devDependencies", "devDependencies"))

    lines: list[str] = []
    for key, label in sections:
        entries = data.get(key) or {}
        if not entries:
            continue
        lines.append(f"package.json [{label}] ({len(entries)}):")
        lines.extend(f"  {name}  {spec}" for name, spec in sorted(entries.items()))
    return lines


def _requirements(root: Path) -> list[str]:
    path = root / "requirements.txt"
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ToolExecutionError(f"Could not read requirements.txt: {exc}") from exc

    entries: list[str] = []
    includes: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-r") or line.startswith("--requirement"):
            includes.append(line)
            continue
        if line.startswith("-"):
            continue
        entries.append(line.split("#")[0].strip())

    lines = [f"requirements.txt ({len(entries)}):"]
    lines.extend(f"  {entry}" for entry in entries)
    if includes:
        lines.append(f"  (also includes, not followed: {', '.join(includes)})")
    return lines


def _pyproject(root: Path, include_dev: bool) -> list[str]:
    path = root / "pyproject.toml"
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ToolExecutionError(f"pyproject.toml is not valid TOML: {exc}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise ToolExecutionError(f"Could not read pyproject.toml: {exc}") from exc

    lines: list[str] = []
    project = data.get("project") or {}

    if deps := project.get("dependencies"):
        lines.append(f"pyproject.toml [project.dependencies] ({len(deps)}):")
        lines.extend(f"  {dep}" for dep in deps)

    if include_dev:
        for extra, deps in (project.get("optional-dependencies") or {}).items():
            lines.append(f"pyproject.toml [optional-dependencies.{extra}] ({len(deps)}):")
            lines.extend(f"  {dep}" for dep in deps)

    poetry = (data.get("tool") or {}).get("poetry") or {}
    if poetry_deps := poetry.get("dependencies"):
        lines.append(f"pyproject.toml [tool.poetry.dependencies] ({len(poetry_deps)}):")
        lines.extend(f"  {name}  {spec}" for name, spec in poetry_deps.items())

    return lines


def _cargo(root: Path) -> list[str]:
    try:
        data = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf-8"))
    except (tomllib.TOMLDecodeError, OSError, UnicodeDecodeError):
        return []
    deps = data.get("dependencies") or {}
    if not deps:
        return []
    lines = [f"Cargo.toml [dependencies] ({len(deps)}):"]
    lines.extend(f"  {name}  {spec}" for name, spec in deps.items())
    return lines


def _go_mod(root: Path) -> list[str]:
    try:
        text = (root / "go.mod").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    entries = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith(("module", "go ", "//", ")", "require ("))
    ]
    if not entries:
        return []
    return [f"go.mod ({len(entries)}):", *(f"  {entry}" for entry in entries)]


def list_dependencies(
    path: str = ".",
    include_dev: bool = True,
    max_results: int = 300,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    root = resolve_safe_path(path or ".", workspace_root)
    if not root.exists():
        raise ToolExecutionError(f"No such path: {path}")
    if not root.is_dir():
        raise ToolExecutionError(f"{path} is a file, not a directory.")

    display = to_display_path(root, workspace_root)
    blocks: list[str] = []

    if (root / "package.json").exists():
        blocks.extend(_package_json(root, include_dev))
    if (root / "requirements.txt").exists():
        blocks.extend(_requirements(root))
    if (root / "pyproject.toml").exists():
        blocks.extend(_pyproject(root, include_dev))
    if (root / "Cargo.toml").exists():
        blocks.extend(_cargo(root))
    if (root / "go.mod").exists():
        blocks.extend(_go_mod(root))

    if not blocks:
        return (
            f"No dependency manifest found in {display}. Looked for package.json, "
            "requirements.txt, pyproject.toml, Cargo.toml and go.mod."
        )

    if len(blocks) > max_results:
        blocks = [*blocks[:max_results], f"... ({len(blocks) - max_results} more lines not shown)"]

    footer = "Declared versions, not resolved ones -- read the lockfile if the exact installed version matters."
    return "\n".join([*blocks, "", footer])


LIST_DEPENDENCIES_TOOL = Tool(
    name="list_dependencies",
    description=(
        "List the dependencies a project declares, read from package.json, "
        "requirements.txt, pyproject.toml, Cargo.toml or go.mod. Use it to "
        "check whether a library is already available before adding it, or "
        "before writing an import. Reports declared version specs, not the "
        "resolved installed versions -- it deliberately does not read "
        "lockfiles."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory holding the manifest. Defaults to the workspace root.",
            },
            "include_dev": {
                "type": "boolean",
                "description": "Include dev/optional dependencies. Defaults to true.",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum lines to return. Defaults to 300.",
            },
        },
        "required": [],
        "additionalProperties": False,
    },
    run=list_dependencies,
    group=INSIGHT_GROUP,
)
