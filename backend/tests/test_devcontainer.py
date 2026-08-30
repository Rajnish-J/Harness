"""Writing the .devcontainer scaffold -- no Docker, no git, no network."""

import json
from pathlib import Path

from app.projects.devcontainer import ensure_devcontainer

DEFAULT = "node:22-bookworm-slim"


def test_writes_scaffold_when_missing(tmp_path: Path) -> None:
    wrote = ensure_devcontainer(tmp_path, project_name="demo", default_image=DEFAULT)
    assert wrote is True

    path = tmp_path / ".devcontainer" / "devcontainer.json"
    assert path.exists()
    body = json.loads(path.read_text())
    assert body == {
        "name": "demo",
        "image": DEFAULT,
        "workspaceFolder": "/workspace",
    }


def test_uses_detected_image(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("flask\n")
    ensure_devcontainer(tmp_path, project_name="demo", default_image=DEFAULT)

    body = json.loads((tmp_path / ".devcontainer" / "devcontainer.json").read_text())
    assert body["image"] == "python:3.12-slim-bookworm"


def test_does_not_overwrite_existing_devcontainer(tmp_path: Path) -> None:
    devcontainer_dir = tmp_path / ".devcontainer"
    devcontainer_dir.mkdir()
    existing = devcontainer_dir / "devcontainer.json"
    existing.write_text('{"name": "custom"}')

    wrote = ensure_devcontainer(tmp_path, project_name="demo", default_image=DEFAULT)

    assert wrote is False
    assert existing.read_text() == '{"name": "custom"}'


def test_creates_devcontainer_directory(tmp_path: Path) -> None:
    assert not (tmp_path / ".devcontainer").exists()
    ensure_devcontainer(tmp_path, project_name="demo", default_image=DEFAULT)
    assert (tmp_path / ".devcontainer").is_dir()
