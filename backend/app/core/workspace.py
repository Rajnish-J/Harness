from pathlib import Path


class WorkspaceSecurityError(Exception):
    """Raised when a tool tries to touch a path outside the sandbox."""


def resolve_safe_path(relative_path: str, workspace_root: Path) -> Path:
    """Resolve `relative_path` inside the sandbox, or refuse.

    This is the only place file paths enter the harness. Every file tool goes
    through it, so escapes have exactly one thing to defeat rather than three.
    """
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise WorkspaceSecurityError("Path must be a non-empty string.")

    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise WorkspaceSecurityError(
            f"Absolute paths are not allowed: {relative_path!r}. "
            "Use a path relative to the workspace root."
        )

    root = workspace_root.resolve()
    # strict=False so we can also resolve paths for files we're about to create.
    # .resolve() collapses `..` *and* follows symlinks, so a symlink pointing
    # out of the sandbox is caught by the containment check below.
    resolved = (root / candidate).resolve()

    if resolved != root and not resolved.is_relative_to(root):
        raise WorkspaceSecurityError(
            f"Path escapes the workspace sandbox: {relative_path!r}. "
            "Access is limited to the workspace directory."
        )

    return resolved


def to_display_path(path: Path, workspace_root: Path) -> str:
    """Render a path relative to the sandbox, so the model never sees host layout."""
    try:
        return str(path.relative_to(workspace_root.resolve())) or "."
    except ValueError:
        return str(path)
