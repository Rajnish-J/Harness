"""Git operations the agent is not allowed to perform.

`app/agent/tools/git_tools.py` deliberately exposes only non-destructive verbs —
status, diff, log, add, commit, branch-list — and withholds clone, checkout,
reset and push from the model. This module holds the withheld half. It is
imported by route handlers only, never registered in `ALL_TOOLS`, and every
function here runs because a person pressed something.

Two things are worth reading carefully:

**The token never enters the remote URL.** The obvious way to clone a private
repo is `https://x-access-token:TOKEN@github.com/owner/repo.git`, and it works —
but git then writes that URL into `.git/config`, the reflog, and the output of
`git remote -v`, so the token outlives the request inside the workspace the agent
can read. Instead the credential is passed per invocation via
`-c http.extraHeader=...`, which git uses for the transport and does not persist,
and the stored remote stays clean.

**`shell=False`, always.** Every call goes through `run_subprocess` with an argv
list, so a branch name containing a semicolon is an argument, not a command.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from pathlib import Path

from app.agent.tools._process import run_subprocess

logger = logging.getLogger(__name__)

# Cloning a large repository is far slower than the 30s a tool call gets.
CLONE_TIMEOUT_SECONDS = 600.0
GIT_TIMEOUT_SECONDS = 120.0
MAX_GIT_OUTPUT_BYTES = 100_000


class GitOperationError(Exception):
    """A git invocation failed. The message is safe to show the operator."""


@dataclass
class GitResult:
    returncode: int
    output: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0


def _auth_args(token: str | None) -> list[str]:
    """`-c http.extraHeader=...`, or nothing at all for a public clone.

    Basic auth with any username and the token as the password is what GitHub
    documents for PATs over HTTPS. The header is set for this process only.
    """
    if not token:
        return []
    encoded = base64.b64encode(f"x-access-token:{token}".encode()).decode("ascii")
    return ["-c", f"http.extraHeader=Authorization: Basic {encoded}"]


def _scrub(text: str, token: str | None) -> str:
    """Remove a token from command output before it is logged or streamed.

    Belt and braces — the header form should keep it out of git's output
    entirely — but output from a failed clone is shown to the operator and
    written to `projects.clone_error`, so it is worth being certain.
    """
    return text.replace(token, "••••") if token else text


async def _git(
    args: list[str],
    *,
    cwd: Path,
    token: str | None = None,
    timeout: float = GIT_TIMEOUT_SECONDS,
) -> GitResult:
    returncode, output = await run_subprocess(
        ["git", *_auth_args(token), *args],
        cwd=cwd,
        timeout=timeout,
        max_output_bytes=MAX_GIT_OUTPUT_BYTES,
        shell=False,
    )
    return GitResult(returncode=returncode, output=_scrub(output, token))


async def clone(
    repo_url: str,
    destination: Path,
    *,
    token: str | None = None,
    branch: str | None = None,
) -> GitResult:
    """Clone `repo_url` into `destination`, which must be empty.

    Cloned at full depth rather than `--depth 1`: the point of a project is that
    the agent can read history and open a pull request from it, and a shallow
    clone makes both awkward in ways that surface much later.
    """
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise GitOperationError(
            f"{destination.name} is not empty — refusing to clone over it."
        )

    args = ["clone", repo_url, str(destination)]
    if branch:
        args[1:1] = ["--branch", branch]

    # cwd is the parent: the destination does not usefully exist yet.
    result = await _git(
        args, cwd=destination.parent, token=token, timeout=CLONE_TIMEOUT_SECONDS
    )
    if not result.ok:
        raise GitOperationError(_clone_hint(result.output))
    return result


def _clone_hint(output: str) -> str:
    """Turn git's clone failure into something with a next action in it."""
    lowered = output.lower()
    if "authentication failed" in lowered or "could not read username" in lowered:
        return (
            "GitHub rejected the credential. Check the token on the Credentials "
            f"page — it may be expired or missing `repo` scope.\n\n{output}"
        )
    if "repository not found" in lowered:
        return (
            "Repository not found. For a private repository this usually means "
            f"the token lacks `repo` scope rather than a wrong name.\n\n{output}"
        )
    if "could not resolve host" in lowered:
        return f"No network route to the host.\n\n{output}"
    return output or "git clone failed with no output."


async def current_branch(repo: Path) -> str | None:
    result = await _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo)
    return result.output.strip() if result.ok else None


async def list_tracked_files(repo: Path) -> list[tuple[str, str]]:
    """Every tracked file as (blob_sha, path), straight from the index.

    `git ls-files -s` rather than a filesystem walk: it already excludes
    .gitignore'd paths and `.git/` itself, and it hands over the blob sha git has
    computed anyway — so change detection costs nothing extra. A walk would have
    to re-implement ignore rules and hash the files itself.
    """
    result = await _git(["ls-files", "-s"], cwd=repo, timeout=GIT_TIMEOUT_SECONDS)
    if not result.ok:
        raise GitOperationError(f"Could not list files: {result.output}")

    entries: list[tuple[str, str]] = []
    for line in result.output.splitlines():
        # <mode> <sha> <stage>\t<path>
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if path and len(parts) >= 2:
            entries.append((parts[1], path))
    return entries
