"""TypeScript/JavaScript structure by line-oriented regex.

Unlike the AST scanner next door, everything here is a heuristic. It finds
declarations written the conventional way and misses anything clever: symbols
built dynamically, assigned inside a closure, produced by a factory, or spread
across lines in a shape these patterns do not anticipate.

That limit is not something to hide. Every tool that falls back to this module
says so in its output and in its description, because a model that trusts an
incomplete symbol list will confidently rename half a call site.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Extensions this module claims to handle.
TS_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}

_EXPORT = r"(?:export\s+(?:default\s+)?)?"

#: (kind, pattern). Order matters only for reporting; the scan tries all of them.
TS_DEF_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("function", re.compile(rf"^\s*{_EXPORT}(?:async\s+)?function\s*\*?\s*(\w+)")),
    ("class", re.compile(rf"^\s*{_EXPORT}(?:abstract\s+)?class\s+(\w+)")),
    ("interface", re.compile(rf"^\s*{_EXPORT}interface\s+(\w+)")),
    ("type", re.compile(rf"^\s*{_EXPORT}type\s+(\w+)\s*[=<]")),
    ("enum", re.compile(rf"^\s*{_EXPORT}(?:const\s+)?enum\s+(\w+)")),
    (
        "const",
        re.compile(
            rf"^\s*{_EXPORT}(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*"
            r"(?:async\s*)?(?:\([^)]*\)\s*(?::[^=]*)?=>|function\b)"
        ),
    ),
    (
        "method",
        re.compile(
            r"^\s{2,}(?:(?:public|private|protected|static|readonly|async)\s+)*"
            r"\*?\s*(\w+)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^{;]+)?\{"
        ),
    ),
)

#: Reserved words the `method` pattern would otherwise report as methods.
_NOT_METHODS = {"if", "for", "while", "switch", "catch", "return", "function", "constructor"}


@dataclass(frozen=True)
class RegexDefinition:
    kind: str
    name: str
    lineno: int
    text: str


def scan_definitions(source: str) -> list[RegexDefinition]:
    found: list[RegexDefinition] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        for kind, pattern in TS_DEF_PATTERNS:
            match = pattern.match(line)
            if not match:
                continue
            name = match.group(1)
            if kind == "method" and name in _NOT_METHODS:
                continue
            found.append(RegexDefinition(kind, name, lineno, line.strip()))
            break
    return found


def find_block_end(lines: list[str], start_index: int) -> int | None:
    """Index of the line closing the block that opens at or after `start_index`.

    A plain brace count is wrong often enough to matter: braces inside strings,
    template literals, regex literals and comments all have to be ignored, and
    a function body containing `"}"` is not rare. So this walks characters with
    just enough lexer state to know when a brace is real.

    Returns None when the block never closes, which for a well-formed file
    means the opening brace was not where we thought it was -- the caller
    reports what it found instead of guessing an end.
    """
    depth = 0
    seen_brace = False
    in_line_comment = False
    in_block_comment = False
    quote: str | None = None

    for index in range(start_index, len(lines)):
        line = lines[index]
        pos = 0
        in_line_comment = False

        while pos < len(line):
            char = line[pos]
            nxt = line[pos + 1] if pos + 1 < len(line) else ""

            if in_line_comment:
                break
            if in_block_comment:
                if char == "*" and nxt == "/":
                    in_block_comment = False
                    pos += 2
                    continue
                pos += 1
                continue
            if quote is not None:
                if char == "\\":
                    pos += 2
                    continue
                if char == quote:
                    quote = None
                pos += 1
                continue

            if char == "/" and nxt == "/":
                in_line_comment = True
                break
            if char == "/" and nxt == "*":
                in_block_comment = True
                pos += 2
                continue
            if char in "\"'`":
                quote = char
                pos += 1
                continue
            if char == "{":
                depth += 1
                seen_brace = True
            elif char == "}":
                depth -= 1
                if seen_brace and depth == 0:
                    return index
            pos += 1

    return None
