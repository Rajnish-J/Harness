"""Python structure via the stdlib `ast` module.

Everything here is exact: the parser is the same one that runs the code, so a
definition it reports really is a definition, at really that line. The regex
scanner next door makes no such promise, and the tools that use both are
careful to say which one produced a given answer.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from dataclasses import dataclass

from app.agent.tools.base import ToolExecutionError

#: Extensions parse_python can handle.
PY_EXTS = {".py", ".pyi"}

_FUNC_NODES = (ast.FunctionDef, ast.AsyncFunctionDef)


@dataclass(frozen=True)
class Definition:
    kind: str  # "function" | "async function" | "class" | "method" | "async method"
    name: str  # bare name, e.g. "run"
    qualname: str  # nesting-aware, e.g. "Tool.run"
    lineno: int  # first line of `def`/`class` itself
    end_lineno: int
    decorator_lineno: int | None  # first decorator, when there is one
    signature: str

    @property
    def qualified_signature(self) -> str:
        """The signature with the bare name replaced by the qualified one.

        An outline row reading `def run(self)` gives no hint which class owns
        it; `def Tool.run(self)` is what makes read_symbol's 'Class.method'
        form guessable from the outline alone.
        """
        if "." not in self.qualname:
            return self.signature
        return self.signature.replace(self.name, self.qualname, 1)


def parse_python(source: str, display_path: str) -> ast.Module:
    try:
        return ast.parse(source)
    except SyntaxError as exc:
        # The line number is the useful half: it tells the model where to look
        # rather than only that something, somewhere, is wrong.
        where = f" line {exc.lineno}" if exc.lineno else ""
        raise ToolExecutionError(
            f"{display_path} is not parseable Python:{where}: {exc.msg}"
        ) from exc


def _render_signature(node: ast.AST) -> str:
    if isinstance(node, ast.ClassDef):
        bases = [ast.unparse(base) for base in node.bases]
        return f"class {node.name}({', '.join(bases)})" if bases else f"class {node.name}"

    args = ast.unparse(node.args) if node.args else ""
    prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    returns = f" -> {ast.unparse(node.returns)}" if node.returns else ""
    return f"{prefix} {node.name}({args}){returns}"


def iter_definitions(tree: ast.Module) -> Iterator[Definition]:
    """Every class, function and method, outermost first, in source order.

    Nesting is tracked so a method reports as `Class.method`: without it,
    find_definition on a common name like `run` cannot tell you which class
    it belongs to, which is most of what makes the answer useful.
    """

    def walk(node: ast.AST, prefix: tuple[str, ...], in_class: bool) -> Iterator[Definition]:
        for child in ast.iter_child_nodes(node):
            if not isinstance(child, (*_FUNC_NODES, ast.ClassDef)):
                continue

            is_class = isinstance(child, ast.ClassDef)
            is_async = isinstance(child, ast.AsyncFunctionDef)
            if is_class:
                kind = "class"
            else:
                base = "method" if in_class else "function"
                kind = f"async {base}" if is_async else base

            qualname = ".".join((*prefix, child.name))
            decorators = getattr(child, "decorator_list", [])
            yield Definition(
                kind=kind,
                name=child.name,
                qualname=qualname,
                lineno=child.lineno,
                end_lineno=child.end_lineno or child.lineno,
                decorator_lineno=min(d.lineno for d in decorators) if decorators else None,
                signature=_render_signature(child),
            )
            yield from walk(child, (*prefix, child.name), in_class=is_class)

    yield from walk(tree, (), in_class=False)


def iter_imports(tree: ast.Module) -> Iterator[tuple[int, str, str]]:
    """(lineno, module, rendered statement) for every import in the file.

    `module` is the thing being imported from -- "os.path" for both
    `import os.path` and `from os.path import join`. A relative import keeps
    its leading dots, since that is what makes it recognisably local.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name, f"import {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            module = ("." * node.level) + (node.module or "")
            names = ", ".join(
                a.name if a.asname is None else f"{a.name} as {a.asname}" for a in node.names
            )
            yield node.lineno, module, f"from {module} import {names}"


def classify_lines(tree: ast.Module, symbol: str) -> dict[int, str]:
    """Label the lines where `symbol` is defined, imported, or called.

    This is the one thing find_references can honestly derive rather than
    guess: the AST knows a given line holds an import statement or a call
    expression. It stops well short of resolution -- it cannot tell you which
    `run` a call refers to -- so the labels describe the syntax, not the
    binding.
    """
    labels: dict[int, str] = {}

    for node in ast.walk(tree):
        if isinstance(node, (*_FUNC_NODES, ast.ClassDef)) and node.name == symbol:
            labels[node.lineno] = "def"
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            if any(a.name.split(".")[-1] == symbol or a.asname == symbol for a in node.names):
                labels[node.lineno] = "import"
            elif isinstance(node, ast.ImportFrom) and (node.module or "").endswith(symbol):
                labels[node.lineno] = "import"
        elif isinstance(node, ast.Call):
            func = node.func
            called = getattr(func, "id", None) or getattr(func, "attr", None)
            # Do not overwrite a def/import label already set for this line.
            if called == symbol:
                labels.setdefault(node.lineno, "call")

    return labels
