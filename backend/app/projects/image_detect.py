"""Best-guess base image for a project, from its own manifest files.

One image for every project (`Settings.default_project_image`) is wrong for
anything that isn't Node. This looks at what a repo already has at its root --
no network calls, no manifest parsing beyond "does this filename exist" -- and
returns the first match. Pure and synchronous, so tests never need Docker or a
real git checkout.
"""

from __future__ import annotations

from pathlib import Path

# Order matters: first match wins. A repo with both, e.g., package.json and
# requirements.txt (a Node app with a Python build script) gets the Node image.
_RULES: tuple[tuple[str, str], ...] = (
    ("package.json", "node:22-bookworm-slim"),
    ("pyproject.toml", "python:3.12-slim-bookworm"),
    ("requirements.txt", "python:3.12-slim-bookworm"),
    ("Pipfile", "python:3.12-slim-bookworm"),
    ("go.mod", "golang:1.23-bookworm"),
    ("Cargo.toml", "rust:1.80-slim-bookworm"),
    ("pom.xml", "eclipse-temurin:21-jdk-jammy"),
    ("build.gradle", "eclipse-temurin:21-jdk-jammy"),
    ("build.gradle.kts", "eclipse-temurin:21-jdk-jammy"),
    ("Gemfile", "ruby:3.3-slim-bookworm"),
    ("composer.json", "php:8.3-cli-bookworm"),
)


def detect_image(repo_root: Path, *, default: str) -> str:
    """The image for the first manifest file found at `repo_root`'s top level.

    Falls back to `default` (normally `Settings.default_project_image`) when
    nothing recognizable is there.
    """
    for filename, image in _RULES:
        if (repo_root / filename).is_file():
            return image
    return default
