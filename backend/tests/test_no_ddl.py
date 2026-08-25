"""Make "Drizzle owns all application DDL" enforceable rather than aspirational.

Drizzle is the single source of schema truth. If Python ever starts issuing DDL
against an application table, the two migration stories silently diverge and the
next `drizzle-kit generate` proposes destructive changes. Cheap to check, so
check it.
"""

import re
from pathlib import Path

import app.db.workflow_repo as repo

APP_DIR = Path(repo.__file__).resolve().parents[1]

DDL = re.compile(
    r"\b(create|alter|drop|truncate)\s+(table|index|schema|type|database)\b",
    re.IGNORECASE,
)

# The checkpointer's own setup() is the single sanctioned exception, and it only
# ever touches LangGraph's tables.
ALLOWED = {"db/pool.py"}


def _python_sources():
    for path in APP_DIR.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        yield path


def test_no_application_ddl_anywhere_in_app():
    offenders = []
    for path in _python_sources():
        rel = path.relative_to(APP_DIR).as_posix()
        if rel in ALLOWED:
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if DDL.search(line):
                offenders.append(f"{rel}:{lineno}: {line.strip()}")
    assert not offenders, "Python must not emit DDL:\n" + "\n".join(offenders)


def test_repo_uses_placeholders_not_fstrings():
    """No f-string or %-format may appear in a SQL string in the repository."""
    source = Path(repo.__file__).read_text()
    offenders = [
        f"line {i}: {line.strip()}"
        for i, line in enumerate(source.splitlines(), 1)
        if re.search(r'f"""|f"|f\'', line)
        and re.search(r"\b(select|insert|update|delete|from|where)\b", line, re.I)
    ]
    assert not offenders, "SQL must be parameterized:\n" + "\n".join(offenders)
