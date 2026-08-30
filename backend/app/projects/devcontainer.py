"""Write a `.devcontainer/devcontainer.json` so a project can be reopened in
VS Code's own Dev Containers extension.

This is intentionally disconnected from `app/projects/containers.py`: that
module starts and stops the container the backend uses to run agent commands;
this one only leaves a config file behind for a human's local VS Code to use
if they choose to. Neither knows about the other's container.

Never overwrites a repo's own `.devcontainer/devcontainer.json` -- if a
project already ships one, that is its author's config, not ours to replace.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.projects.image_detect import detect_image

CONTAINER_WORKDIR = "/workspace"


def ensure_devcontainer(
    repo_root: Path, *, project_name: str, default_image: str
) -> bool:
    """Write the scaffold if this repo doesn't already have one.

    Returns True if a file was written, False if one already existed.
    """
    path = repo_root / ".devcontainer" / "devcontainer.json"
    if path.exists():
        return False

    image = detect_image(repo_root, default=default_image)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "name": project_name,
        "image": image,
        "workspaceFolder": CONTAINER_WORKDIR,
    }
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8", newline="")
    return True
