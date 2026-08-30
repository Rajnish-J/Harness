"""The index describes a repository without storing it.

Runs against a real git repository built in a temp directory, because the whole
point of `git ls-files` over `os.walk` is that git applies .gitignore for us —
a test with a fake file list would verify none of that.
"""

import subprocess
from pathlib import Path

import pytest

from app.projects.indexer import index_repository


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    # Identity is required for commit, and must not depend on the machine's.
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")

    # write_bytes, not write_text: on Windows text mode turns "\n" into "\r\n",
    # which would make the recorded size platform-dependent.
    (repo / "README.md").write_bytes(b"# hello\n")
    (repo / "main.py").write_text("print('hi')\n")
    (repo / ".gitignore").write_text("ignored.txt\nnode_modules/\n")
    (repo / "ignored.txt").write_text("should never be indexed")
    (repo / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)

    nested = repo / "src" / "lib"
    nested.mkdir(parents=True)
    (nested / "util.ts").write_text("export const x = 1;\n")

    modules = repo / "node_modules" / "pkg"
    modules.mkdir(parents=True)
    (modules / "index.js").write_text("module.exports = {};\n")

    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "initial")
    return repo


@pytest.mark.asyncio
async def test_indexes_tracked_files(repo: Path) -> None:
    files = await index_repository(repo, max_file_bytes=200_000)
    paths = {f.path for f in files}
    assert {"README.md", "main.py", "src/lib/util.ts", "logo.png"} <= paths


@pytest.mark.asyncio
async def test_gitignored_paths_are_never_indexed(repo: Path) -> None:
    """The reason this uses git ls-files instead of walking the filesystem."""
    paths = {f.path for f in await index_repository(repo, max_file_bytes=200_000)}
    assert "ignored.txt" not in paths
    assert not any(p.startswith("node_modules/") for p in paths)


@pytest.mark.asyncio
async def test_git_internals_are_never_indexed(repo: Path) -> None:
    paths = {f.path for f in await index_repository(repo, max_file_bytes=200_000)}
    assert not any(p.startswith(".git/") for p in paths)


@pytest.mark.asyncio
async def test_paths_are_posix_even_on_windows(repo: Path) -> None:
    """The stored path is the key the UI and the file API both use."""
    paths = [f.path for f in await index_repository(repo, max_file_bytes=200_000)]
    assert all("\\" not in p for p in paths)
    assert "src/lib/util.ts" in paths


@pytest.mark.asyncio
async def test_directory_and_name_are_split_for_tree_queries(repo: Path) -> None:
    files = {f.path: f for f in await index_repository(repo, max_file_bytes=200_000)}

    nested = files["src/lib/util.ts"]
    assert nested.dir_path == "src/lib"
    assert nested.name == "util.ts"
    assert nested.ext == ".ts"

    top = files["README.md"]
    assert top.dir_path == ""  # root, not "."


@pytest.mark.asyncio
async def test_text_and_binary_are_distinguished(repo: Path) -> None:
    files = {f.path: f for f in await index_repository(repo, max_file_bytes=200_000)}
    assert files["main.py"].is_binary is False
    assert files["README.md"].is_binary is False
    assert files["logo.png"].is_binary is True


@pytest.mark.asyncio
async def test_oversized_text_is_flagged_binary(repo: Path) -> None:
    """Editors should refuse a 40MB file rather than try to render it."""
    files = {f.path: f for f in await index_repository(repo, max_file_bytes=4)}
    assert files["main.py"].is_binary is True


@pytest.mark.asyncio
async def test_blob_sha_comes_from_git(repo: Path) -> None:
    """Change detection is free because git already computed this."""
    files = {f.path: f for f in await index_repository(repo, max_file_bytes=200_000)}
    sha = files["README.md"].git_blob_sha
    assert sha and len(sha) == 40
    assert all(c in "0123456789abcdef" for c in sha)


@pytest.mark.asyncio
async def test_sizes_are_recorded(repo: Path) -> None:
    files = {f.path: f for f in await index_repository(repo, max_file_bytes=200_000)}
    assert files["README.md"].size_bytes == len(b"# hello\n")


@pytest.mark.asyncio
async def test_no_file_content_is_captured(repo: Path) -> None:
    """The index describes the repo; the checkout stores it."""
    files = await index_repository(repo, max_file_bytes=200_000)
    fields = vars(files[0])
    assert not any(
        isinstance(v, (bytes, bytearray)) for v in fields.values()
    ), "the index must not carry file bytes"
    assert "content" not in fields
