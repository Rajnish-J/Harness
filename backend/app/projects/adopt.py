"""Move a global chat's scratch files into a project's checkout.

The chat on `/` has no project, so its file tools write to the bare
`settings.workspace_root` -- `backend/workspace/` -- while a project's tools
write under `{workspace_root}/projects/{id}/repo` (see app/projects/workspaces.py).
Turning that conversation into a project therefore has to move the bytes as
well as re-file the chat, or the project opens on an empty tree while the
transcript above it describes files that are not there.

Copy, never move: a failed adoption has to leave the scratch tree intact,
because until the copy is committed it is the only copy. Nothing is deleted
afterwards either -- the global transcript still refers to those paths, and the
same conversation could plausibly be adopted twice.
"""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from app.core.config import Settings
from app.core.workspace import WorkspaceSecurityError, resolve_safe_path
from app.projects.workspaces import PROJECTS_DIRNAME, project_workspace

logger = logging.getLogger(__name__)


class AdoptError(RuntimeError):
    """The adoption could not be performed at all."""


@dataclass
class AdoptResult:
    copied: list[str] = field(default_factory=list)
    #: (path, why) for everything deliberately left behind.
    skipped: list[tuple[str, str]] = field(default_factory=list)


def adopt_paths(
    settings: Settings, project_id: str, paths: Sequence[str]
) -> AdoptResult:
    """Copy `paths` from the scratch workspace into the project's repo.

    `paths` arrives from the client, so both ends of every copy go through
    `resolve_safe_path` -- the source against the scratch root and the
    destination against the project's checkout. That is the same guardrail every
    file tool uses, and it is the reason a `../` or an absolute path here cannot
    reach outside either tree.
    """
    source_root = settings.workspace_root
    destination_root = project_workspace(settings, project_id)

    result = AdoptResult()

    for raw in paths:
        try:
            source = resolve_safe_path(raw, source_root)
        except WorkspaceSecurityError as exc:
            result.skipped.append((raw, str(exc)))
            continue

        # A scratch path can never legitimately start with `projects/`: that
        # subtree is where OTHER projects' checkouts live, and copying out of it
        # would let one project's files be pulled into another.
        relative = source.relative_to(source_root.resolve())
        if relative.parts and relative.parts[0] == PROJECTS_DIRNAME:
            result.skipped.append((raw, "not a scratch-workspace file"))
            continue

        if not source.exists():
            result.skipped.append((raw, "no longer exists"))
            continue
        if source.is_dir():
            # Directories arrive implicitly with their files; make_directory
            # calls in a transcript are not themselves worth copying.
            result.skipped.append((raw, "is a directory"))
            continue

        try:
            target = resolve_safe_path(str(relative).replace("\\", "/"), destination_root)
        except WorkspaceSecurityError as exc:
            result.skipped.append((raw, str(exc)))
            continue

        # Never overwrite -- the same posture as apply_template and
        # ensure_devcontainer. A scaffolded README.md is a likely collision and
        # silently clobbering it would destroy the template's work.
        if target.exists():
            result.skipped.append((raw, "already exists in the project"))
            continue

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        except OSError as exc:
            result.skipped.append((raw, f"could not copy: {exc}"))
            continue

        result.copied.append(str(relative).replace("\\", "/"))

    return result
