"""The token must never end up somewhere it outlives the request.

The clone URL is the obvious place a PAT leaks: put it in the remote and git
writes it into .git/config, the reflog, and `git remote -v` — inside the very
workspace the agent can read. These tests pin the header-based alternative.
"""

import base64
from pathlib import Path

import pytest

from app.projects.git_ops import (
    GitOperationError,
    _auth_args,
    _clone_hint,
    _scrub,
    clone,
    init_repo,
    set_remote,
)

TOKEN = "ghp_secretTokenValue0001"


def test_auth_args_are_empty_without_a_token() -> None:
    """A public clone must not carry an empty Authorization header."""
    assert _auth_args(None) == []
    assert _auth_args("") == []


def test_auth_args_use_an_http_header_not_a_url() -> None:
    args = _auth_args(TOKEN)
    assert args[0] == "-c"
    assert args[1].startswith("http.extraHeader=Authorization: Basic ")

    encoded = args[1].split("Basic ", 1)[1]
    assert base64.b64decode(encoded).decode() == f"x-access-token:{TOKEN}"


def test_auth_args_never_contain_the_raw_token() -> None:
    """Base64 is not secrecy, but the token must not appear verbatim in argv."""
    assert TOKEN not in " ".join(_auth_args(TOKEN))


def test_scrub_removes_the_token_from_output() -> None:
    leaked = f"fatal: could not read from https://{TOKEN}@github.com/x/y"
    assert TOKEN not in _scrub(leaked, TOKEN)
    assert "••••" in _scrub(leaked, TOKEN)


def test_scrub_is_a_noop_without_a_token() -> None:
    assert _scrub("plain output", None) == "plain output"


@pytest.mark.asyncio
async def test_clone_refuses_a_non_empty_destination(tmp_path: Path) -> None:
    """Cloning over existing work would destroy it, so it is refused early."""
    destination = tmp_path / "repo"
    destination.mkdir()
    (destination / "existing.txt").write_text("do not clobber me")

    with pytest.raises(GitOperationError, match="not empty"):
        await clone("https://example.com/x/y.git", destination)

    assert (destination / "existing.txt").read_text() == "do not clobber me"


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        ("fatal: Authentication failed for 'https://github.com/x/y'", "Credentials"),
        ("ERROR: Repository not found.", "`repo` scope"),
        ("fatal: could not resolve host: github.com", "No network route"),
    ],
)
def test_clone_hint_explains_common_failures(output: str, expected: str) -> None:
    assert expected in _clone_hint(output)


def test_clone_hint_preserves_the_original_output() -> None:
    """The hint adds context; it must not hide what git actually said."""
    output = "ERROR: Repository not found."
    assert output in _clone_hint(output)


def test_clone_hint_handles_empty_output() -> None:
    assert _clone_hint("") != ""


@pytest.mark.asyncio
async def test_init_repo_creates_a_repository_on_the_requested_branch(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "repo"
    await init_repo(destination, branch="main")

    assert (destination / ".git").is_dir()


@pytest.mark.asyncio
async def test_init_repo_refuses_a_non_empty_destination(tmp_path: Path) -> None:
    """Same guard as `clone`: never initialize over existing work."""
    destination = tmp_path / "repo"
    destination.mkdir()
    (destination / "existing.txt").write_text("do not clobber me")

    with pytest.raises(GitOperationError, match="not empty"):
        await init_repo(destination)

    assert (destination / "existing.txt").read_text() == "do not clobber me"


@pytest.mark.asyncio
async def test_set_remote_adds_origin_when_absent(tmp_path: Path) -> None:
    destination = tmp_path / "repo"
    await init_repo(destination)

    await set_remote(destination, "https://github.com/octocat/example.git")

    result = await _git_remote_urls(destination)
    assert result == "https://github.com/octocat/example.git"


@pytest.mark.asyncio
async def test_set_remote_repoints_an_existing_origin(tmp_path: Path) -> None:
    destination = tmp_path / "repo"
    await init_repo(destination)
    await set_remote(destination, "https://github.com/octocat/first.git")

    await set_remote(destination, "https://github.com/octocat/second.git")

    result = await _git_remote_urls(destination)
    assert result == "https://github.com/octocat/second.git"


async def _git_remote_urls(repo: Path) -> str:
    from app.projects.git_ops import _git

    result = await _git(["remote", "get-url", "origin"], cwd=repo)
    return result.output.strip()
