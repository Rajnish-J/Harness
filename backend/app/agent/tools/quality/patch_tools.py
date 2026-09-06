"""`apply_patch` and `multi_edit`: multi-change edits that land or don't.

The unified-diff applier is written here rather than shelled out to `git apply`
or `patch(1)`. Three reasons, in order of how much they matter: both would
bypass resolve_safe_path, which is the one choke point every file path in this
harness goes through; `patch` does not exist on Windows; and `git apply` needs
the workspace to be a git repository, which it often is not.

**The guarantee.** Both tools apply everything in memory first and write only
if every part succeeded. A hunk that does not match, a path that escapes the
sandbox, a result over the size limit -- any of these aborts before a single
byte is written. That is what lets a failure message say "nothing was applied"
and be believed, which in turn is what stops a model from re-applying the half
it thinks got through.

The honest edge: the final write is a loop over files, so an OS-level failure
(disk full, permissions) partway through a multi-file patch can leave earlier
files written. Closing that needs a journal, which is out of proportion to the
risk here. So the descriptions say "no file is modified unless every hunk
applies cleanly" -- precisely true -- rather than "atomic", which would claim
more than this delivers.

Line endings are normalised to \\n for matching and restored on write. Without
that, a patch generated anywhere but Windows fails every context line against a
CRLF file, which looks like a mysterious mismatch rather than an encoding
issue.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.agent.tools.base import Tool, ToolExecutionError
from app.core.workspace import resolve_safe_path, to_display_path

#: Same group as the other file-mutating tools, so the composer shows them together.
FILE_GROUP = "File Operations"

#: How far from the stated @@ offset a hunk may be found. Model-generated line
#: numbers drift by a few lines routinely; beyond this the match is more likely
#: coincidence than the intended location.
_DRIFT = 20

_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")

_DEV_NULL = "/dev/null"


@dataclass
class _FilePatch:
    old_path: str | None  # None for a newly created file
    new_path: str | None  # None for a deletion
    hunks: list[list[str]] = field(default_factory=list)
    starts: list[int] = field(default_factory=list)


def _strip_prefix(path: str) -> str:
    path = path.strip()
    # Trailing tab-separated timestamp, as produced by diff -u.
    path = path.split("\t")[0].strip()
    if path == _DEV_NULL:
        return _DEV_NULL
    for prefix in ("a/", "b/"):
        if path.startswith(prefix):
            return path[len(prefix) :]
    return path


def _parse_patch(patch: str) -> list[_FilePatch]:
    """Split a unified diff into per-file hunks. Pure parsing -- touches no disk."""
    lines = patch.splitlines()
    files: list[_FilePatch] = []
    current: _FilePatch | None = None
    index = 0

    while index < len(lines):
        line = lines[index]

        if line.startswith("--- "):
            old = _strip_prefix(line[4:])
            if index + 1 >= len(lines) or not lines[index + 1].startswith("+++ "):
                raise ToolExecutionError(
                    f"Malformed patch: '--- ' at line {index + 1} is not followed by '+++ '."
                )
            new = _strip_prefix(lines[index + 1][4:])
            current = _FilePatch(
                old_path=None if old == _DEV_NULL else old,
                new_path=None if new == _DEV_NULL else new,
            )
            files.append(current)
            index += 2
            continue

        if line.startswith("@@"):
            match = _HUNK_RE.match(line)
            if not match:
                raise ToolExecutionError(f"Malformed hunk header at line {index + 1}: {line!r}")
            if current is None:
                raise ToolExecutionError(
                    f"Hunk at line {index + 1} has no '--- '/'+++ ' file header before it."
                )
            body: list[str] = []
            index += 1
            while index < len(lines):
                candidate = lines[index]
                if candidate.startswith(("@@", "--- ", "diff ", "index ")):
                    break
                if candidate and candidate[0] not in " +-\\":
                    break
                body.append(candidate)
                index += 1
            current.hunks.append(body)
            current.starts.append(int(match.group(1)))
            continue

        index += 1

    if not files or not any(f.hunks for f in files):
        raise ToolExecutionError(
            "No hunks found. A unified diff needs '--- a/path', '+++ b/path' and "
            "at least one '@@ -old,count +new,count @@' header."
        )
    return files


def _match_at(haystack: list[str], expected: list[str], offset: int) -> bool:
    if offset < 0 or offset + len(expected) > len(haystack):
        return False
    return haystack[offset : offset + len(expected)] == expected


def _locate(haystack: list[str], expected: list[str], stated: int, label: str) -> int:
    """Find where `expected` sits, allowing for drift. Raises if it is ambiguous."""
    if not expected:
        return max(0, min(stated, len(haystack)))

    if _match_at(haystack, expected, stated):
        return stated

    # Search outward, nearest first, so the closest plausible spot wins.
    candidates = [
        offset
        for distance in range(1, _DRIFT + 1)
        for offset in (stated - distance, stated + distance)
        if _match_at(haystack, expected, offset)
    ]
    if not candidates:
        wanted = expected[0] if expected else ""
        actual = haystack[stated] if 0 <= stated < len(haystack) else "(past end of file)"
        raise ToolExecutionError(
            f"{label} does not apply: expected {wanted!r} at line {stated + 1}, "
            f"found {actual!r}. Nothing was applied. Re-read the file and "
            "regenerate the patch against its current contents."
        )
    nearest = min(candidates, key=lambda offset: abs(offset - stated))
    if sum(1 for offset in candidates if abs(offset - nearest) > 0) and len(
        {offset for offset in candidates if abs(offset - stated) == abs(nearest - stated)}
    ) > 1:
        raise ToolExecutionError(
            f"{label} is ambiguous: its context matches in more than one place "
            "near the stated line. Nothing was applied. Add more context lines."
        )
    return nearest


def _apply_hunks(original: list[str], patch: _FilePatch, display: str) -> tuple[list[str], int, int]:
    result = list(original)
    drift = 0
    added = removed = 0

    for number, (body, stated_start) in enumerate(zip(patch.hunks, patch.starts), start=1):
        label = f"Hunk {number} of {display}"
        expected = [line[1:] for line in body if line and line[0] in " -"]
        replacement = [line[1:] for line in body if line and line[0] in " +"]

        offset = _locate(result, expected, max(0, stated_start - 1 + drift), label)
        result[offset : offset + len(expected)] = replacement

        drift += len(replacement) - len(expected)
        added += sum(1 for line in body if line.startswith("+"))
        removed += sum(1 for line in body if line.startswith("-"))

    return result, added, removed


def _read_preserving_endings(target: Path) -> str:
    """Read a file WITHOUT universal-newline translation.

    Path.read_text collapses CRLF to LF on the way in, so a Windows file looks
    like a Unix one and its real endings are unrecoverable by the time we write
    back. newline="" is what keeps them visible long enough to restore.
    """
    with target.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def _split_lines(text: str) -> tuple[list[str], str]:
    """Lines without endings, plus the file's dominant line ending."""
    ending = "\r\n" if text.count("\r\n") > text.count("\n") - text.count("\r\n") else "\n"
    return text.replace("\r\n", "\n").split("\n"), ending


def apply_patch(
    patch: str,
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    if not isinstance(patch, str) or not patch.strip():
        raise ToolExecutionError("patch must be a non-empty unified diff.")

    # ---- phase 1: parse. No I/O, so a malformed patch costs nothing. -------
    parsed = _parse_patch(patch)

    # ---- phase 2: resolve and apply in memory. Reads only. ----------------
    planned: list[tuple[Path, str | None, str]] = []  # (target, new text or None, display)

    for file_patch in parsed:
        relative = file_patch.new_path or file_patch.old_path
        if relative is None:
            raise ToolExecutionError("A patch entry has /dev/null on both sides.")

        target = resolve_safe_path(relative, workspace_root)
        display = to_display_path(target, workspace_root)

        if file_patch.new_path is None:
            if not target.exists():
                raise ToolExecutionError(
                    f"Cannot delete {display}: it does not exist. Nothing was applied."
                )
            planned.append((target, None, display))
            continue

        if file_patch.old_path is None:
            if target.exists():
                raise ToolExecutionError(
                    f"Patch creates {display}, but it already exists. Nothing was applied."
                )
            # One empty line: a hunk that adds N lines then joins against it
            # leaves exactly one trailing newline, as a text file should have.
            original, ending = [""], "\n"
        else:
            if not target.exists():
                raise ToolExecutionError(
                    f"Cannot patch {display}: no such file. Nothing was applied."
                )
            try:
                original, ending = _split_lines(_read_preserving_endings(target))
            except UnicodeDecodeError as exc:
                raise ToolExecutionError(f"{display} is not valid UTF-8 text: {exc}") from exc

        updated, _, _ = _apply_hunks(original, file_patch, display)
        text = ending.join(updated)

        if len(text.encode("utf-8")) > max_file_bytes:
            raise ToolExecutionError(
                f"Patching {display} would exceed the {max_file_bytes}-byte limit. "
                "Nothing was applied."
            )
        planned.append((target, text, display))

    # ---- phase 3: write. Only reached when every file applied cleanly. -----
    summary: list[str] = []
    for target, text, display in planned:
        if text is None:
            target.unlink()
            summary.append(f"  {display}  deleted")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="")
        summary.append(f"  {display}")

    hunks = sum(len(file_patch.hunks) for file_patch in parsed)
    return "\n".join([f"Applied {hunks} hunk(s) across {len(planned)} file(s):", *summary])


def multi_edit(
    path: str,
    edits: list[dict],
    *,
    workspace_root: Path,
    max_file_bytes: int,
    **_ignored: object,
) -> str:
    if not isinstance(edits, list) or not edits:
        raise ToolExecutionError("edits must be a non-empty list of {old_string, new_string}.")

    target = resolve_safe_path(path, workspace_root)
    display = to_display_path(target, workspace_root)

    if not target.exists():
        raise ToolExecutionError(f"No such file: {display}")
    if target.is_dir():
        raise ToolExecutionError(f"{display} is a directory, not a file.")

    try:
        original = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ToolExecutionError(f"{display} is not valid UTF-8 text: {exc}") from exc

    text = original
    total = len(edits)

    for number, edit in enumerate(edits, start=1):
        if not isinstance(edit, dict):
            raise ToolExecutionError(
                f"Edit {number} of {total} is not an object with old_string and "
                "new_string. No edits were applied."
            )
        old = edit.get("old_string")
        new = edit.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str):
            raise ToolExecutionError(
                f"Edit {number} of {total} needs string old_string and new_string. "
                "No edits were applied."
            )
        if old == new:
            raise ToolExecutionError(
                f"Edit {number} of {total} has identical old_string and new_string, "
                "which would do nothing. No edits were applied."
            )

        occurrences = text.count(old)
        if occurrences == 0:
            raise ToolExecutionError(
                f"Edit {number} of {total} failed: old_string not found in {display}. "
                "No edits were applied."
            )
        if occurrences > 1 and not edit.get("replace_all"):
            raise ToolExecutionError(
                f"Edit {number} of {total} failed: old_string appears {occurrences} "
                f"times in {display}. Add surrounding context to make it unique, or "
                "set replace_all. No edits were applied."
            )
        text = text.replace(old, new) if edit.get("replace_all") else text.replace(old, new, 1)

    if len(text.encode("utf-8")) > max_file_bytes:
        raise ToolExecutionError(
            f"Result would exceed the {max_file_bytes}-byte limit. No edits were applied."
        )

    target.write_text(text, encoding="utf-8", newline="")

    diff = list(
        difflib.unified_diff(original.splitlines(), text.splitlines(), lineterm="", n=0)
    )
    added = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
    return f"Applied {total} edit(s) to {display} (+{added} -{removed} lines)."


PATCH_TOOLS: list[Tool] = [
    Tool(
        name="apply_patch",
        description=(
            "Apply a unified diff across one or more files in a single call. No "
            "file is modified unless every hunk in the patch applies cleanly, so "
            "a failure leaves the workspace exactly as it was -- do not re-apply "
            "part of a patch that failed. Line numbers may drift by up to 20 "
            "lines as long as the surrounding context still matches uniquely. "
            "Supports creating files (--- /dev/null) and deleting them "
            "(+++ /dev/null). Paths are relative to the workspace root; a/ and "
            "b/ prefixes are stripped."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "patch": {
                    "type": "string",
                    "description": (
                        "The unified diff, including '--- ', '+++ ' and '@@' headers."
                    ),
                }
            },
            "required": ["patch"],
            "additionalProperties": False,
        },
        run=apply_patch,
        group=FILE_GROUP,
    ),
    Tool(
        name="multi_edit",
        description=(
            "Make several exact-string edits to one file in a single call. Each "
            "edit is applied to the result of the previous one, so later edits "
            "see earlier changes. All-or-nothing: if any edit fails to match, "
            "the file is left untouched and nothing is applied -- do not re-run "
            "the edits you think succeeded. Each old_string must match exactly "
            "once unless replace_all is set. Prefer this over several edit_file "
            "calls on the same file."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path relative to the workspace root.",
                },
                "edits": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Edits applied in order, each to the result of the last.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_string": {
                                "type": "string",
                                "description": "Exact text to find, including whitespace.",
                            },
                            "new_string": {
                                "type": "string",
                                "description": "Text to replace it with.",
                            },
                            "replace_all": {
                                "type": "boolean",
                                "description": (
                                    "Replace every occurrence instead of requiring "
                                    "exactly one. Defaults to false."
                                ),
                            },
                        },
                        "required": ["old_string", "new_string"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["path", "edits"],
            "additionalProperties": False,
        },
        run=multi_edit,
        group=FILE_GROUP,
    ),
]
