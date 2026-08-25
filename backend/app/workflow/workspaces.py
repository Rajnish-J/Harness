"""Per-run sandbox directories.

Every node in one run shares a directory, so a critic node can read what a
writer node produced. Two concurrent runs get separate directories, so they
cannot overwrite each other's files.

This needs no change to `loop.py` or the file tools: they already read
`settings.workspace_root`, so pointing a cloned Settings at the run directory
re-roots the existing `resolve_safe_path` guardrail. The sandbox check is
unchanged — only where it is anchored moves.
"""

import re
from pathlib import Path

from app.core.config import Settings

RUNS_DIRNAME = "runs"

# Run ids come from the database as UUIDs, but this is the value that becomes a
# filesystem path, so it is validated rather than trusted.
_SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class InvalidRunIdError(ValueError):
    pass


def run_workspace(settings: Settings, run_id: str) -> Path:
    """Resolve (and create) the sandbox directory for one run."""
    if not _SAFE_RUN_ID.match(run_id or ""):
        raise InvalidRunIdError(f"unsafe run id for a directory name: {run_id!r}")

    root = settings.workspace_root.resolve()
    path = (root / RUNS_DIRNAME / run_id).resolve()

    # Belt and braces: the regex already forbids separators and dots.
    if not path.is_relative_to(root):
        raise InvalidRunIdError(f"run directory escapes the workspace: {run_id!r}")

    path.mkdir(parents=True, exist_ok=True)
    return path


def settings_for_run(settings: Settings, run_id: str) -> Settings:
    """A Settings clone whose workspace_root is this run's directory."""
    return settings.model_copy(update={"workspace_root": run_workspace(settings, run_id)})
