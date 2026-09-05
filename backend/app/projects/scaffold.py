"""Copy a starter template into a fresh project's working tree.

Deterministic and offline: no network, no package manager, no model. What lands
on disk is exactly what is committed under templates/files/, with two
transformations -- dotfile un-masking and {{placeholder}} substitution.

The dotfile masking deserves the explanation. A template that shipped a literal
`.gitignore` would be honoured by *this* repository's git, which would then
exclude the template's own files from the commit that adds them. So they are
committed as `dot_gitignore` and renamed on the way out. The prefix is `dot_`
rather than a bare `_` because Python dunders start with an underscore too.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from app.core.workspace import resolve_safe_path
from app.projects.templates import TEMPLATES_DIR, Template

#: Files whose bodies get {{project_name}} / {{project_slug}} substituted.
#: Everything else is copied byte-for-byte, so a future binary asset is safe.
_RENDERABLE_SUFFIXES = frozenset(
    {
        ".md",
        ".json",
        ".toml",
        ".txt",
        ".html",
        ".css",
        ".py",
        ".ts",
        ".tsx",
        ".mjs",
        ".yml",
    }
)

#: How a template ships a dotfile. See the module docstring.
#:
#: Not a bare leading "_": Python dunders start with one too, and stripping it
#: turned __init__.py into ._init__.py -- a silently broken package.
_DOTFILE_PREFIX = "dot_"

_SKIP_DIRS = frozenset({"__pycache__", ".pytest_cache"})


class ScaffoldError(RuntimeError):
    """A template could not be written."""


def _target_name(name: str) -> str:
    """`dot_gitignore` -> `.gitignore`; everything else is passed through."""
    if name.startswith(_DOTFILE_PREFIX) and len(name) > len(_DOTFILE_PREFIX):
        return "." + name[len(_DOTFILE_PREFIX) :]
    return name


def _render(
    text: str, *, project_name: str, project_slug: str, package_slug: str
) -> str:
    """Substitute the three placeholders a template may use.

    project_slug and package_slug are separate because the ecosystems disagree:
    npm wants "expense-tracker", and a Python package directory cannot contain a
    hyphen at all. Collapsing them into one would break whichever came second.
    """
    return (
        text.replace("{{project_name}}", project_name)
        .replace("{{package_slug}}", package_slug)
        .replace("{{project_slug}}", project_slug)
    )


def apply_template(
    destination: Path,
    template: Template,
    *,
    project_name: str,
    project_slug: str,
) -> list[str]:
    """Write `template`'s tree into `destination`; return the repo-relative paths.

    Never overwrites an existing file -- the same posture as ensure_devcontainer,
    so re-running init over a populated tree adds what is missing and disturbs
    nothing else.
    """
    source_root = TEMPLATES_DIR / template.source
    if not source_root.is_dir():
        raise ScaffoldError(
            f"Template {template.id!r} has no source directory at {source_root}."
        )

    # A Python package directory cannot contain a hyphen, and slugs routinely do.
    package_slug = project_slug.replace("-", "_")
    render = lambda text: _render(  # noqa: E731 - one binding, used three times
        text,
        project_name=project_name,
        project_slug=project_slug,
        package_slug=package_slug,
    )

    written: list[str] = []
    for source in sorted(source_root.rglob("*")):
        if _SKIP_DIRS & set(source.parts):
            continue
        if source.is_dir():
            continue

        relative = source.relative_to(source_root)
        parts = [_target_name(part) for part in relative.parts]
        rendered = [render(part) for part in parts]
        relative_target = "/".join(rendered)

        # These are our own files, so this is belt-and-braces -- but
        # resolve_safe_path is *the* path guardrail in this codebase and file
        # writing does not get to have one exception to it.
        target = resolve_safe_path(relative_target, destination)
        if target.exists():
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            if source.suffix in _RENDERABLE_SUFFIXES:
                body = source.read_text(encoding="utf-8")
                # newline="" keeps LF on Windows, matching devcontainer.py; a
                # template that wrote CRLF would make the first diff all noise.
                target.write_text(render(body), encoding="utf-8", newline="")
            else:
                shutil.copyfile(source, target)
        except OSError as exc:
            raise ScaffoldError(f"Could not write {relative_target}: {exc}") from exc

        written.append(relative_target)

    return written
