"""`project_overview`: what kind of project is this, and what can I run?

The single highest-value line in the output is the configured-commands block.
run_tests and friends refuse when their command is unset, and a model that
discovers that by calling them burns a turn per tool to learn something this
answers in one call, before it starts.

Everything here is detection from files that already exist. Nothing is
inferred from a name, and nothing is executed.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path, to_display_path

INSIGHT_GROUP = "Project Insight"

#: Files that identify a stack, and how to describe one when it is only detected.
_MARKER_FILES = {
    "Cargo.toml": "Rust (cargo)",
    "go.mod": "Go modules",
    "pom.xml": "Java (Maven)",
    "build.gradle": "Java/Kotlin (Gradle)",
    "Gemfile": "Ruby (bundler)",
    "composer.json": "PHP (composer)",
    "Dockerfile": "Docker image build",
    "docker-compose.yml": "Docker Compose",
    "docker-compose.yaml": "Docker Compose",
    "Makefile": "Make",
}

#: Conventional entrypoints, checked by existence only.
_ENTRYPOINTS = (
    "main.py",
    "app.py",
    "manage.py",
    "index.js",
    "server.js",
    "src/index.ts",
    "src/main.ts",
    "src/main.rs",
    "app/page.tsx",
    "app/main.py",
    "cmd",
)

_MAX_OUTPUT_CHARS = 4000


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ToolExecutionError(f"{path.name} is not valid JSON: {exc}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise ToolExecutionError(f"Could not read {path.name}: {exc}") from exc


def _read_toml(path: Path) -> dict:
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ToolExecutionError(f"{path.name} is not valid TOML: {exc}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise ToolExecutionError(f"Could not read {path.name}: {exc}") from exc


def _describe_package_json(root: Path, lines: list[str]) -> None:
    data = _read_json(root / "package.json")
    name = data.get("name") or "(unnamed)"
    version = data.get("version") or "?"
    lines.append(f"Node package: {name} @ {version}")

    if manager := data.get("packageManager"):
        lines.append(f"  package manager: {manager}")

    deps = data.get("dependencies") or {}
    dev = data.get("devDependencies") or {}
    lines.append(f"  dependencies: {len(deps)} runtime, {len(dev)} dev")

    notable = [n for n in ("next", "react", "vue", "svelte", "express", "vite") if n in deps]
    if notable:
        lines.append(f"  notable: {', '.join(notable)}")

    scripts = data.get("scripts") or {}
    if scripts:
        lines.append("  scripts:")
        # Verbatim, not summarised: these are the commands a human would run.
        lines.extend(f"    {key}: {value}" for key, value in scripts.items())


def _describe_pyproject(root: Path, lines: list[str]) -> None:
    data = _read_toml(root / "pyproject.toml")
    project = data.get("project") or {}
    poetry = (data.get("tool") or {}).get("poetry") or {}

    name = project.get("name") or poetry.get("name") or "(unnamed)"
    lines.append(f"Python project: {name}")

    if requires := project.get("requires-python"):
        lines.append(f"  requires-python: {requires}")
    if backend := (data.get("build-system") or {}).get("build-backend"):
        lines.append(f"  build backend: {backend}")
    if scripts := project.get("scripts"):
        lines.append(f"  console scripts: {', '.join(scripts)}")
    if "pytest" in (data.get("tool") or {}):
        lines.append("  pytest configured in pyproject.toml")


def _describe_requirements(root: Path, lines: list[str]) -> None:
    try:
        text = (root / "requirements.txt").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return
    names = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith(("#", "-"))
    ]
    lines.append(f"requirements.txt: {len(names)} pinned dependencies")
    if names:
        head = ", ".join(n.split("==")[0].split(">=")[0].strip() for n in names[:12])
        more = f", ... (+{len(names) - 12})" if len(names) > 12 else ""
        lines.append(f"  {head}{more}")


def _describe_tsconfig(root: Path, lines: list[str]) -> None:
    # tsconfig.json routinely contains comments, which json cannot parse. It is
    # worth reporting that it exists even when we cannot read it.
    try:
        data = _read_json(root / "tsconfig.json")
    except ToolExecutionError:
        lines.append("tsconfig.json present (not parsed: contains comments or is malformed)")
        return
    options = data.get("compilerOptions") or {}
    lines.append(f"tsconfig.json: strict={options.get('strict', False)}")
    if paths := options.get("paths"):
        lines.append(f"  path aliases: {', '.join(paths)}")


def _detect_test_runner(root: Path) -> list[str]:
    found = []
    if (root / "pytest.ini").exists():
        found.append("pytest (pytest.ini)")
    if (root / "tox.ini").exists():
        found.append("tox")
    for name in ("jest.config.js", "jest.config.ts", "vitest.config.ts", "vitest.config.js"):
        if (root / name).exists():
            found.append(name)
    if (root / "playwright.config.ts").exists():
        found.append("playwright")
    return found


def project_overview(
    path: str = ".",
    *,
    workspace_root: Path,
    max_file_bytes: int,
    test_command: str | None = None,
    lint_command: str | None = None,
    build_command: str | None = None,
    typecheck_command: str | None = None,
    format_command: str | None = None,
    **_ignored: object,
) -> str:
    root = resolve_safe_path(path or ".", workspace_root)
    if not root.exists():
        raise ToolExecutionError(f"No such path: {path}")
    if not root.is_dir():
        raise ToolExecutionError(f"{path} is a file, not a directory.")

    display = to_display_path(root, workspace_root)
    lines: list[str] = [f"Project overview: {display}", ""]
    found_manifest = False

    if (root / "package.json").exists():
        _describe_package_json(root, lines)
        found_manifest = True
    if (root / "pyproject.toml").exists():
        _describe_pyproject(root, lines)
        found_manifest = True
    if (root / "requirements.txt").exists():
        _describe_requirements(root, lines)
        found_manifest = True
    if (root / "tsconfig.json").exists():
        _describe_tsconfig(root, lines)
        found_manifest = True

    markers = [label for name, label in _MARKER_FILES.items() if (root / name).exists()]
    if markers:
        found_manifest = True
        lines.append(f"Also detected: {', '.join(sorted(set(markers)))}")

    if runners := _detect_test_runner(root):
        lines.append(f"Test config: {', '.join(runners)}")

    workflows = root / ".github" / "workflows"
    if workflows.is_dir():
        names = sorted(p.name for p in workflows.glob("*.y*ml"))
        if names:
            lines.append(f"CI workflows: {', '.join(names)}")

    if (root / ".devcontainer").is_dir():
        lines.append("Dev container: .devcontainer/ present")

    entrypoints = [name for name in _ENTRYPOINTS if (root / name).exists()]
    if entrypoints:
        lines.append(f"Entrypoints: {', '.join(entrypoints)}")

    # The part that saves a wasted turn: which verification actually exists.
    lines.append("")
    lines.append("Commands configured in this harness (unset ones refuse when called):")
    for label, value in (
        ("run_tests", test_command),
        ("run_lint", lint_command),
        ("run_build", build_command),
        ("run_typecheck", typecheck_command),
        ("run_format", format_command),
    ):
        lines.append(f"  {label:<14} {value if value else '(not configured)'}")

    if not found_manifest:
        entries = sorted(p.name + ("/" if p.is_dir() else "") for p in list(root.iterdir())[:20])
        lines.insert(
            2,
            "No package manifest found here. Top-level entries: "
            + (", ".join(entries) if entries else "(empty directory)"),
        )

    rendered = "\n".join(lines)
    if len(rendered) > _MAX_OUTPUT_CHARS:
        rendered = rendered[:_MAX_OUTPUT_CHARS] + "\n... (overview truncated)"
    return rendered


PROJECT_OVERVIEW_TOOL = Tool(
    name="project_overview",
    description=(
        "Identify a project's stack, entrypoints and CI from the manifests "
        "already on disk, and report which of run_tests / run_lint / run_build "
        "/ run_typecheck / run_format are actually configured. Call this first "
        "in an unfamiliar repository: it tells you what verification is "
        "available to you before you need it, instead of finding out one "
        "refusal at a time. Reads files only -- it runs nothing."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory to inspect. Defaults to the workspace root.",
            }
        },
        "required": [],
        "additionalProperties": False,
    },
    run=project_overview,
    group=INSIGHT_GROUP,
)
