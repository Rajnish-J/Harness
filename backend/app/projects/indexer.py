"""Build the `project_files` index for a cloned repository.

What this deliberately does NOT do is store file content. The checkout on disk is
the source of truth for bytes; the index exists so the UI can render a file tree
without walking the filesystem, and so a re-index can skip unchanged files by
comparing the blob sha git already computed.

The file list comes from `git ls-files`, not `os.walk`, which means .gitignore
and `.git/` are handled by git rather than re-implemented here — a walk would
happily index `node_modules/` and a 200MB pack file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.projects.git_ops import list_tracked_files

logger = logging.getLogger(__name__)

# Extensions worth opening in an editor. Anything else is listed in the tree but
# flagged binary, so the UI can show it without trying to render it as text.
_TEXT_EXTENSIONS = frozenset(
    """
    .ts .tsx .js .jsx .mjs .cjs .json .jsonc .py .pyi .rb .go .rs .java .kt .kts
    .c .h .cpp .hpp .cc .cs .php .swift .scala .clj .ex .exs .erl .hs .lua .r
    .sql .sh .bash .zsh .fish .ps1 .bat .cmd .html .htm .css .scss .sass .less
    .vue .svelte .astro .md .mdx .rst .txt .yaml .yml .toml .ini .cfg .conf .env
    .gitignore .dockerignore .editorconfig .lock .gradle .properties .xml .svg
    .csv .tsv .graphql .gql .proto .tf .tfvars .makefile .mk .cmake .dart
    """.split()
)

# Files without an extension that are still text.
_TEXT_FILENAMES = frozenset(
    {
        "dockerfile",
        "makefile",
        "rakefile",
        "gemfile",
        "procfile",
        "license",
        "readme",
        "changelog",
        "contributing",
        "codeowners",
        "notice",
        "authors",
    }
)


@dataclass
class IndexedFile:
    path: str
    dir_path: str
    name: str
    ext: str | None
    size_bytes: int
    is_binary: bool
    git_blob_sha: str


def _is_text(name: str, ext: str | None) -> bool:
    if ext and ext.lower() in _TEXT_EXTENSIONS:
        return True
    # `.gitignore` splits as name=".gitignore", ext="" on some paths, so check
    # the bare name too.
    stem = name.lower().lstrip(".")
    return stem in _TEXT_FILENAMES or name.lower() in _TEXT_EXTENSIONS


async def index_repository(repo: Path, *, max_file_bytes: int) -> list[IndexedFile]:
    """Describe every tracked file in `repo`.

    `max_file_bytes` only decides whether a file is treated as openable — an
    oversized text file is still listed, just flagged binary so the editor
    refuses it rather than trying to load 40MB into Monaco.
    """
    entries = await list_tracked_files(repo)
    indexed: list[IndexedFile] = []

    for blob_sha, rel_path in entries:
        # git always reports forward slashes; keep them, including on Windows,
        # so the stored path matches what the UI and the API use as a key.
        posix = rel_path.replace("\\", "/")
        name = posix.rsplit("/", 1)[-1]
        dir_path = posix.rsplit("/", 1)[0] if "/" in posix else ""
        suffix = Path(name).suffix
        ext = suffix.lower() or None

        try:
            size = (repo / posix).stat().st_size
        except OSError:
            # Tracked but absent: a broken symlink, or a sparse checkout. Record
            # it so the tree matches the index rather than silently dropping it.
            size = 0

        indexed.append(
            IndexedFile(
                path=posix,
                dir_path=dir_path,
                name=name,
                ext=ext,
                size_bytes=size,
                is_binary=not _is_text(name, ext) or size > max_file_bytes,
                git_blob_sha=blob_sha,
            )
        )

    logger.info("indexed %d files under %s", len(indexed), repo)
    return indexed
