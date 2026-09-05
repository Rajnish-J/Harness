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
#: A strict subset of _TEXT_SUFFIXES: every template file today is one of
#: these, but not every text file need be a substitution target (a future
#: template could ship a plain text asset with literal {{ }} in it).
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

#: Extensions copied byte-for-byte, with no read_text/write_text at all --
#: the true "not text" set. Everything else, INCLUDING an extensionless file
#: like the dotfiles below, goes through the text path so it gets the
#: newline="" normalization.
#:
#: The bug this replaced: `dot_gitignore` has no suffix, so it never matched
#: _RENDERABLE_SUFFIXES and fell through to shutil.copyfile -- a byte-exact
#: copy of whatever is on disk. On a Windows checkout with core.autocrlf=true
#: (the default many contributors have, with no .gitattributes here to
#: override it) that byte-exact copy is CRLF, so every scaffolded project's
#: .gitignore silently carried CRLF -- the noisy-first-diff outcome the
#: newline="" rule exists to prevent, reached anyway because a suffix check
#: was doing duty as a text/binary check.
_BINARY_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"})

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
            if source.suffix in _BINARY_SUFFIXES:
                shutil.copyfile(source, target)
            else:
                # Read as text and rewritten with newline="" even when this
                # file gets no {{ }} substitution: this is what keeps LF on
                # Windows (matching devcontainer.py) instead of passing
                # through whatever core.autocrlf did to it on checkout.
                body = source.read_text(encoding="utf-8")
                if source.suffix in _RENDERABLE_SUFFIXES:
                    body = render(body)
                target.write_text(body, encoding="utf-8", newline="")
        except OSError as exc:
            raise ScaffoldError(f"Could not write {relative_target}: {exc}") from exc

        written.append(relative_target)

    return written
