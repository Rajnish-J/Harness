"""Per-project sandbox directories.

The same idea as app/workflow/workspaces.py, applied to a longer-lived unit: a
workflow run's directory is scratch space that dies with the run, while a
project's directory holds a git clone that persists across sessions.

As there, this needs no change to `loop.py` or the file tools. They already read
`settings.workspace_root` from whatever Settings they are handed per call, so
pointing a cloned Settings at a project directory re-anchors the existing
`resolve_safe_path` guardrail. The sandbox check is unchanged — only where it is
anchored moves.

Layout::

    {workspace_root}/projects/{project_id}/repo    <- the git clone

The extra `repo/` level exists so per-project state that is not part of the
repository — logs, build caches, anything a later milestone adds — has somewhere
to live that `git status` will never see.
"""

import os
import re
import shutil
import stat
import sys
from pathlib import Path

from app.core.config import Settings

PROJECTS_DIRNAME = "projects"
REPO_DIRNAME = "repo"

# Project ids come from the database as UUIDs, but this is the value that becomes
# a filesystem path, so it is validated rather than trusted.
_SAFE_PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class InvalidProjectIdError(ValueError):
    pass


def project_root(settings: Settings, project_id: str) -> Path:
    """The directory holding everything for one project."""
    if not _SAFE_PROJECT_ID.match(project_id or ""):
        raise InvalidProjectIdError(
            f"unsafe project id for a directory name: {project_id!r}"
        )

    root = settings.workspace_root.resolve()
    path = (root / PROJECTS_DIRNAME / project_id).resolve()

    # Belt and braces: the regex already forbids separators and dots.
    if not path.is_relative_to(root):
        raise InvalidProjectIdError(
            f"project directory escapes the workspace: {project_id!r}"
        )
    return path


def project_workspace(settings: Settings, project_id: str) -> Path:
    """Resolve (and create) the checkout directory for one project."""
    path = project_root(settings, project_id) / REPO_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def settings_for_project(settings: Settings, project_id: str) -> Settings:
    """A Settings clone whose workspace_root is this project's checkout."""
    return settings.model_copy(
        update={"workspace_root": project_workspace(settings, project_id)}
    )


def _force_remove(func, path: str, _excinfo: object) -> None:
    """Make a read-only file writable, then retry deleting it.

    git marks everything under `.git/objects` read-only. POSIX only needs write
    permission on the *directory* to unlink a file, so this never comes up
    there — but on Windows `os.unlink` checks the file itself and fails with
    "Access is denied", which made removing a checkout impossible.
    """
    os.chmod(path, stat.S_IWRITE)
    func(path)


def remove_project_workspace(settings: Settings, project_id: str) -> None:
    """Delete a project's directory entirely. Used when a clone fails.

    A half-finished clone is worse than none: it looks like a working checkout to
    everything downstream. Removing it means a retry starts from a clean slate
    rather than tripping over `git clone`'s refusal to write into a non-empty
    directory.
    """
    path = project_root(settings, project_id)
    if not path.exists():
        return

    # Same callable either way — both hooks are called with (func, path, exc).
    # `onerror` is deprecated in 3.12, `onexc` does not exist before it.
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_force_remove)
    else:  # pragma: no cover - the supported runtime is 3.12
        shutil.rmtree(path, onerror=_force_remove)
