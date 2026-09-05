"""Command line entry point for {{project_name}}."""

from __future__ import annotations

import argparse
from collections.abc import Sequence


def greet(name: str) -> str:
    return f"Hello, {name}!"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="{{package_slug}}", description="{{project_name}}")
    parser.add_argument("name", nargs="?", default="world", help="who to greet")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Return an exit code rather than calling sys.exit, so tests can call it."""
    args = build_parser().parse_args(argv)
    print(greet(args.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
