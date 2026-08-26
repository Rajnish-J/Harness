#!/usr/bin/env python3
"""Generate docs/BRANCHES.md — a ledger of every branch in this repository.

One row per branch: what it was for, when it started, when it merged, and into
what. Everything is derived from the GitHub API (via the `gh` CLI) and from git
itself; nothing here is hand-maintained. To correct a purpose, add an entry to
docs/branch-notes.json rather than editing the generated file.

Run by .github/workflows/branch-ledger.yml after every PR merges into main.

Stdlib only, on purpose: the workflow runs this on a bare GitHub runner with no
install step, so it must not need pip. That is also why the override file is
JSON and not YAML.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "docs" / "BRANCHES.md"
OVERRIDES = REPO_ROOT / "docs" / "branch-notes.json"

# Fields pulled in a single `gh pr list` call. Every one of them is used below;
# `gh` errors on unknown field names, so this list is also a compatibility check.
# `commits` is deliberately absent: it is a nested GraphQL connection, and at
# this page size gh's query exceeds GitHub's 500,000-node ceiling and 500s. The
# commit count is counted from git instead, in commit_count().
PR_FIELDS = [
    "number",
    "title",
    "body",
    "headRefName",
    "baseRefName",
    "createdAt",
    "mergedAt",
    "closedAt",
    "state",
    "url",
    "author",
    "mergeCommit",
    "additions",
    "deletions",
    "changedFiles",
]

# Width of the Purpose column in the summary tables. The untruncated text always
# survives in the Details section, so this only governs scannability.
PURPOSE_WIDTH = 160

EM_DASH = "—"
MINUS = "\u2212"  # U+2212, so "+120 / −8" aligns instead of using a hyphen


# --------------------------------------------------------------------------
# shelling out
# --------------------------------------------------------------------------


def run(args: list[str], *, check: bool = True) -> str:
    """Run a command in the repo root and return its stdout, stripped."""
    result = subprocess.run(
        args,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(args)}\n"
            f"{result.stderr.strip()}"
        )
    return result.stdout.strip()


def git(*args: str, check: bool = True) -> str:
    return run(["git", *args], check=check)


def detect_repo() -> str:
    """Return "owner/name" for the current repository."""
    return run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])


def fetch_pulls(repo: str) -> list[dict]:
    raw = run(
        [
            "gh",
            "pr",
            "list",
            "--repo",
            repo,
            "--state",
            "all",
            "--limit",
            "200",
            "--json",
            ",".join(PR_FIELDS),
        ]
    )
    return json.loads(raw) if raw else []


def fetch_branches(repo: str) -> dict[str, str]:
    """Live branches on the remote, mapped to their tip SHA."""
    raw = run(["gh", "api", f"repos/{repo}/branches", "--paginate"])
    if not raw:
        return {}
    # --paginate concatenates one JSON array per page; parse them all.
    branches: dict[str, str] = {}
    decoder = json.JSONDecoder()
    index = 0
    while index < len(raw):
        page, offset = decoder.raw_decode(raw, index)
        for entry in page:
            branches[entry["name"]] = entry["commit"]["sha"]
        index = offset
        while index < len(raw) and raw[index].isspace():
            index += 1
    return branches


def default_branch(repo: str) -> str:
    return run(
        ["gh", "repo", "view", repo, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"]
    )


# --------------------------------------------------------------------------
# derivation
# --------------------------------------------------------------------------


def branch_start_from_merge(merge_sha: str | None) -> str | None:
    """Author date of a branch's first commit, recovered from its merge commit.

    A merge commit has two parents: the base branch (P1) and the merged branch
    tip (P2). Everything in P1..P2 is exactly the branch's own work, so its
    oldest commit is where the branch began — which is typically earlier, often
    by hours, than when the PR was opened.

    Returns None when the merge was a squash or rebase (one parent, so the
    branch's commits are gone), or when the object is not present locally —
    the caller falls back to the PR's creation date. This is why the workflow
    checks out with fetch-depth: 0.
    """
    if not merge_sha:
        return None
    parents = git("rev-list", "--parents", "-n", "1", merge_sha, check=False).split()
    if len(parents) < 3:  # sha + 2 parents; fewer means it was not a real merge
        return None
    base, tip = parents[1], parents[2]
    first = git("log", "--reverse", "--format=%aI", f"{base}..{tip}", check=False)
    return first.splitlines()[0] if first else None


def branch_start_from_ref(branch: str, base: str) -> str | None:
    """Branch start for a branch with no PR: oldest commit not on the base."""
    for rev in (f"origin/{branch}", branch):
        if git("rev-parse", "--verify", "--quiet", rev, check=False):
            divergent = git("log", "--reverse", "--format=%aI", f"origin/{base}..{rev}", check=False)
            if divergent:
                return divergent.splitlines()[0]
            # Fully merged or identical to base: fall back to the tip's own date.
            return git("log", "-1", "--format=%aI", rev, check=False) or None
    return None


def commit_count(merge_sha: str | None, branch: str, base: str) -> int | None:
    """How many commits the branch contributed, counted from git.

    From the merge commit when there is one (P1..P2 is exactly the branch's own
    work), otherwise from the live ref against the base. None when neither is
    reachable — a squashed merge on a deleted branch leaves nothing to count.
    """
    if merge_sha:
        parents = git("rev-list", "--parents", "-n", "1", merge_sha, check=False).split()
        if len(parents) >= 3:
            count = git("rev-list", "--count", f"{parents[1]}..{parents[2]}", check=False)
            if count.isdigit() and int(count):
                return int(count)
    for rev in (f"origin/{branch}", branch):
        if git("rev-parse", "--verify", "--quiet", rev, check=False):
            count = git("rev-list", "--count", f"origin/{base}..{rev}", check=False)
            # A zero here means "already merged, nothing left to count", not
            # "this branch had no commits" — report it as unknown rather than
            # printing a misleading "0 commits".
            if count.isdigit() and int(count):
                return int(count)
    return None


def last_commit(branch: str) -> tuple[str | None, str | None]:
    """(author date, subject) of a branch's tip, or (None, None) if unreachable."""
    for rev in (f"origin/{branch}", branch):
        if git("rev-parse", "--verify", "--quiet", rev, check=False):
            line = git("log", "-1", "--format=%aI%x09%s", rev, check=False)
            if line and "\t" in line:
                date, _, subject = line.partition("\t")
                return date, subject
    return None, None


def strip_markdown(text: str) -> str:
    """Flatten a paragraph of Markdown into one readable line of plain text."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)          # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)      # links -> label
    text = re.sub(r"`{1,3}([^`]*)`{1,3}", r"\1", text)        # code spans
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)            # bold
    text = re.sub(r"(?<!\w)\*([^*]+)\*(?!\w)", r"\1", text)   # italics
    text = re.sub(r"(?<!\w)_([^_]+)_(?!\w)", r"\1", text)     # italics, underscore
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text)             # heading marker
    return re.sub(r"\s+", " ", text).strip()


def first_paragraph(body: str | None) -> str:
    """The first real prose paragraph of a PR body, as one plain-text line."""
    if not body:
        return ""
    # Drop HTML comments (PR templates) before splitting on blank lines.
    body = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)
    for block in body.replace("\r\n", "\n").split("\n\n"):
        cleaned = strip_markdown(block)
        # Skip badge rows, headings-only blocks and table fragments.
        if cleaned and not block.lstrip().startswith(("#", "|", ">")):
            return cleaned
    return ""


def truncate(text: str, width: int = PURPOSE_WIDTH) -> str:
    if len(text) <= width:
        return text
    return text[: width - 1].rstrip(" ,;:.") + "…"


def as_date(timestamp: str | None) -> str:
    """ISO-8601 timestamp -> YYYY-MM-DD in UTC, or an em dash."""
    if not timestamp:
        return EM_DASH
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return EM_DASH
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d")


def sort_key(timestamp: str | None) -> str:
    """Descending-sortable key; missing timestamps sort last."""
    return timestamp or ""


# --------------------------------------------------------------------------
# model
# --------------------------------------------------------------------------


@dataclass
class Entry:
    branch: str
    base: str
    status: str  # merged | open | closed | none
    purpose: str  # full text, untruncated
    created: str | None
    merged: str | None
    number: int | None = None
    url: str | None = None
    author: str | None = None
    title: str | None = None
    commits: int | None = None
    changed_files: int | None = None
    additions: int | None = None
    deletions: int | None = None
    tip_subject: str | None = None
    live: bool = False
    notes: str | None = None

    @property
    def changes(self) -> str:
        if self.changed_files is None:
            return EM_DASH
        files = f"{self.changed_files} file{'s' if self.changed_files != 1 else ''}"
        return f"{files}, +{self.additions or 0} / {MINUS}{self.deletions or 0}"


def build_entries(repo: str, base_branch: str) -> list[Entry]:
    overrides = {}
    if OVERRIDES.exists():
        overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))

    pulls = fetch_pulls(repo)
    live_branches = fetch_branches(repo)
    entries: list[Entry] = []
    branches_with_prs: set[str] = set()

    for pull in pulls:
        branch = pull["headRefName"]
        branches_with_prs.add(branch)

        if pull["state"] == "MERGED":
            status = "merged"
        elif pull["state"] == "OPEN":
            status = "open"
        else:
            status = "closed"

        merge_sha = (pull.get("mergeCommit") or {}).get("oid")
        created = branch_start_from_merge(merge_sha) or pull.get("createdAt")

        override = overrides.get(branch, {})
        purpose = override.get("purpose") or first_paragraph(pull.get("body")) or pull["title"]

        entries.append(
            Entry(
                branch=branch,
                base=pull["baseRefName"],
                status=status,
                purpose=purpose,
                created=created,
                merged=pull.get("mergedAt"),
                number=pull["number"],
                url=pull.get("url"),
                author=(pull.get("author") or {}).get("login"),
                title=pull["title"],
                commits=commit_count(merge_sha, branch, pull["baseRefName"]),
                changed_files=pull.get("changedFiles"),
                additions=pull.get("additions"),
                deletions=pull.get("deletions"),
                live=branch in live_branches,
                notes=override.get("notes"),
            )
        )

    for branch in sorted(live_branches):
        if branch in branches_with_prs or branch == base_branch:
            continue
        override = overrides.get(branch, {})
        _, tip_subject = last_commit(branch)
        entries.append(
            Entry(
                branch=branch,
                base=base_branch,
                status="none",
                purpose=override.get("purpose") or "",
                created=branch_start_from_ref(branch, base_branch),
                merged=None,
                tip_subject=tip_subject or None,
                live=True,
                notes=override.get("notes"),
            )
        )

    return entries


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def cell(text: str) -> str:
    """Escape a value so it cannot break out of a Markdown table cell."""
    return text.replace("|", "\\|").replace("\n", " ")


def pr_link(entry: Entry) -> str:
    if entry.number is None:
        return EM_DASH
    return f"[#{entry.number}]({entry.url})" if entry.url else f"#{entry.number}"


def render(entries: list[Entry], repo: str, base_branch: str) -> str:
    merged = sorted(
        (e for e in entries if e.status == "merged"),
        key=lambda e: sort_key(e.merged),
        reverse=True,
    )
    openish = sorted(
        (e for e in entries if e.status == "open"),
        key=lambda e: sort_key(e.created),
        reverse=True,
    )
    closed = sorted(
        (e for e in entries if e.status == "closed"),
        key=lambda e: sort_key(e.created),
        reverse=True,
    )
    orphans = sorted((e for e in entries if e.status == "none"), key=lambda e: e.branch)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines: list[str] = [
        "# Branch Ledger",
        "",
        "<!-- GENERATED FILE — do not edit by hand.",
        "     Produced by scripts/generate_branch_log.py, run automatically by",
        "     .github/workflows/branch-ledger.yml after every PR merges into main.",
        "     To correct a purpose, edit docs/branch-notes.json instead. -->",
        "",
        f"Every branch in [`{repo}`](https://github.com/{repo}) — what it was for, when it",
        f"started, and when it landed. The base branch is `{base_branch}`.",
        "",
        (
            f"_Last updated {today} (UTC) · {len(merged)} merged · {len(openish)} open · "
            f"{len(closed)} closed unmerged · {len(orphans)} without a PR_"
        ),
        "",
    ]

    lines += ["## Merged branches", ""]
    if merged:
        lines += [
            "| Branch | PR | Purpose | Created | Merged | Into | Changes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for entry in merged:
            lines.append(
                f"| `{cell(entry.branch)}` | {pr_link(entry)} "
                f"| {cell(truncate(entry.purpose))} | {as_date(entry.created)} "
                f"| {as_date(entry.merged)} | `{cell(entry.base)}` | {entry.changes} |"
            )
    else:
        lines.append("_None yet._")
    lines.append("")

    lines += ["## Open pull requests", ""]
    if openish:
        lines += [
            "| Branch | PR | Purpose | Created | Opened | Into | Changes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for entry in openish:
            lines.append(
                f"| `{cell(entry.branch)}` | {pr_link(entry)} "
                f"| {cell(truncate(entry.purpose))} | {as_date(entry.created)} "
                f"| {as_date(entry.created)} | `{cell(entry.base)}` | {entry.changes} |"
            )
    else:
        lines.append("_None open._")
    lines.append("")

    if closed:
        lines += [
            "## Closed without merging",
            "",
            "| Branch | PR | Purpose | Created | Closed | Into |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for entry in closed:
            lines.append(
                f"| `{cell(entry.branch)}` | {pr_link(entry)} "
                f"| {cell(truncate(entry.purpose))} | {as_date(entry.created)} "
                f"| {as_date(entry.merged)} | `{cell(entry.base)}` |"
            )
        lines.append("")

    lines += ["## Branches without a pull request", ""]
    if orphans:
        lines += [
            "| Branch | Purpose | Created | Latest commit |",
            "| --- | --- | --- | --- |",
        ]
        for entry in orphans:
            purpose = cell(truncate(entry.purpose)) if entry.purpose else EM_DASH
            subject = cell(entry.tip_subject) if entry.tip_subject else EM_DASH
            lines.append(
                f"| `{cell(entry.branch)}` | {purpose} | {as_date(entry.created)} | {subject} |"
            )
    else:
        lines.append("_None — every branch on the remote has a pull request._")
    lines.append("")

    detailed = merged + openish + closed
    if detailed:
        lines += ["---", "", "## Details", ""]
        for entry in detailed:
            heading = f"### `{entry.branch}` → `{entry.base}`"
            if entry.number is not None:
                heading += f" ({pr_link(entry)})"
            lines += [heading, ""]

            if entry.status == "merged":
                state = f"**Merged** {as_date(entry.merged)}"
            elif entry.status == "open":
                state = "**Open**"
            else:
                state = f"**Closed unmerged** {as_date(entry.merged)}"

            facts = [state, f"created {as_date(entry.created)}"]
            if entry.author:
                facts.append(f"by @{entry.author}")
            if entry.commits:
                facts.append(f"{entry.commits} commit{'s' if entry.commits != 1 else ''}")
            if entry.changed_files is not None:
                facts.append(entry.changes)
            facts.append("branch still on the remote" if entry.live else "branch deleted")
            lines += [" · ".join(facts), ""]

            if entry.title and entry.title != entry.purpose:
                lines += [f"**{entry.title}**", ""]
            if entry.purpose:
                lines += [entry.purpose, ""]
            if entry.notes:
                lines += [entry.notes, ""]

    lines += [
        "---",
        "",
        "## How this file is maintained",
        "",
        "This ledger is generated, not written. `.github/workflows/branch-ledger.yml`",
        "runs `scripts/generate_branch_log.py` every time a pull request merges into",
        f"`{base_branch}` and commits the result back to `{base_branch}`. Hand edits are",
        "overwritten on the next merge.",
        "",
        "Each branch's purpose comes from its pull request — the title and the first",
        "paragraph of the description — so a well-written PR body produces a good entry",
        "here for free. To override or add to what is extracted, edit",
        "`docs/branch-notes.json`:",
        "",
        "```json",
        "{",
        '  "some-branch": {',
        '    "purpose": "One line replacing the auto-extracted summary.",',
        '    "notes": "Optional extra prose, shown only in the Details section."',
        "  }",
        "}",
        "```",
        "",
        "To regenerate locally (requires an authenticated `gh`):",
        "",
        "```bash",
        "python scripts/generate_branch_log.py",
        "```",
        "",
        "`--check` verifies the committed file is current without writing, exiting 1 if",
        "it is stale.",
        "",
    ]

    return "\n".join(lines)


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--repo",
        help="owner/name to read PRs from (default: autodetected from the git remote)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="write nothing; exit 1 if the committed ledger is out of date",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT,
        help=f"where to write the ledger (default: {OUTPUT.relative_to(REPO_ROOT)})",
    )
    args = parser.parse_args()

    repo = args.repo or detect_repo()
    base_branch = default_branch(repo)
    content = render(build_entries(repo, base_branch), repo, base_branch)

    if args.check:
        existing = args.output.read_text(encoding="utf-8") if args.output.exists() else None
        if existing == content:
            print(f"{args.output.name} is up to date")
            return 0
        print(
            f"{args.output.name} is out of date — run `python scripts/generate_branch_log.py`",
            file=sys.stderr,
        )
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    print(f"wrote {args.output.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
