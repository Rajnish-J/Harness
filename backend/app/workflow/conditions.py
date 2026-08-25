"""A safe, declarative predicate DSL for condition nodes.

There is deliberately no expression parser and no `eval()` anywhere in this
module. A predicate is a nested JSON structure with an allowlisted operator set,
and operands are *tagged* — `{"path": ...}` or `{"value": ...}` — so there is
never an "is this string a path or a literal?" ambiguity. That ambiguity is
exactly where injection creeps into hand-rolled rule engines.

Grammar:
    Predicate  := Comparison | {"all": [Predicate…]}
                            | {"any": [Predicate…]}
                            | {"not": Predicate}
    Comparison := {"left": Operand, "op": <allowlisted>, "right"?: Operand,
                   "case_insensitive"?: bool}
    Operand    := {"path": "<dotted path>"} | {"value": <JSON scalar or list>}

Pure module: no I/O, no LangGraph, no LLM.
"""

from typing import Any

# Operators taking a right-hand operand.
BINARY_OPS = frozenset(
    {
        "eq",
        "ne",
        "lt",
        "lte",
        "gt",
        "gte",
        "contains",
        "not_contains",
        "starts_with",
        "ends_with",
        "in",
        "not_in",
    }
)

# Operators taking only a left-hand operand.
UNARY_OPS = frozenset({"is_empty", "is_not_empty", "is_true", "is_false"})

ALL_OPS = BINARY_OPS | UNARY_OPS

# Operators that require the right operand to be a list.
_LIST_RIGHT_OPS = frozenset({"in", "not_in"})

# Deliberately NOT supported, and why:
#   regex      - ReDoS on a user-supplied pattern; would need RE2 or a hard timeout
#   arithmetic - no evaluator means no evaluator to escape
#   any callable / attribute reference - the entire attack surface we're avoiding

_MAX_DEPTH = 10
_MAX_PATH_SEGMENTS = 6


class PredicateError(ValueError):
    """A predicate is structurally invalid. Raised by validate_predicate()."""


# --------------------------------------------------------------------------
# Path resolution
# --------------------------------------------------------------------------

def _resolve_path(path: str, state: dict[str, Any]) -> Any:
    """Walk a dotted path through plain dict/list data only.

    Uses `dict.get` and integer list indexing exclusively — never getattr, never
    __getitem__ on arbitrary objects. A path like `__class__.__mro__` therefore
    resolves to None rather than reaching into the Python object graph, and is
    rejected outright by validate_path() before it ever gets here.
    """
    current: Any = state
    for segment in path.split("."):
        if isinstance(current, dict):
            current = current.get(segment)
        elif isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return None
        else:
            return None
        if current is None:
            return None
    return current


def validate_path(path: str) -> None:
    if not isinstance(path, str) or not path.strip():
        raise PredicateError("path must be a non-empty string")
    segments = path.split(".")
    if len(segments) > _MAX_PATH_SEGMENTS:
        raise PredicateError(f"path {path!r} is too deep (max {_MAX_PATH_SEGMENTS})")
    for segment in segments:
        if not segment:
            raise PredicateError(f"path {path!r} has an empty segment")
        # Dunder segments can only be an attempt to reach into the object graph.
        if segment.startswith("__") or segment.endswith("__"):
            raise PredicateError(f"path segment {segment!r} is not allowed")
        if not all(c.isalnum() or c in "-_" for c in segment):
            raise PredicateError(
                f"path segment {segment!r} may only contain letters, digits, "
                "'-' and '_'"
            )


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def _validate_operand(operand: Any, side: str) -> None:
    if not isinstance(operand, dict):
        raise PredicateError(f"{side} operand must be an object")
    has_path = "path" in operand
    has_value = "value" in operand
    if has_path == has_value:
        raise PredicateError(
            f"{side} operand must have exactly one of 'path' or 'value'"
        )
    if has_path:
        validate_path(operand["path"])
    else:
        value = operand["value"]
        if isinstance(value, (dict,)):
            raise PredicateError(f"{side} operand value must be a scalar or list")
        if isinstance(value, list) and any(
            isinstance(item, (dict, list)) for item in value
        ):
            raise PredicateError(f"{side} operand list must contain only scalars")


def validate_predicate(predicate: Any, _depth: int = 0) -> None:
    """Raise PredicateError if `predicate` is not a well-formed predicate."""
    if _depth > _MAX_DEPTH:
        raise PredicateError(f"predicate nested deeper than {_MAX_DEPTH}")
    if not isinstance(predicate, dict):
        raise PredicateError("predicate must be an object")

    if "all" in predicate or "any" in predicate:
        key = "all" if "all" in predicate else "any"
        branch = predicate[key]
        if not isinstance(branch, list) or not branch:
            raise PredicateError(f"{key!r} must be a non-empty list of predicates")
        for child in branch:
            validate_predicate(child, _depth + 1)
        return

    if "not" in predicate:
        validate_predicate(predicate["not"], _depth + 1)
        return

    op = predicate.get("op")
    if op not in ALL_OPS:
        raise PredicateError(
            f"unknown operator {op!r}. Allowed: {', '.join(sorted(ALL_OPS))}"
        )

    _validate_operand(predicate.get("left"), "left")

    if op in UNARY_OPS:
        if "right" in predicate:
            raise PredicateError(f"operator {op!r} takes no right operand")
        return

    if "right" not in predicate:
        raise PredicateError(f"operator {op!r} requires a right operand")
    _validate_operand(predicate["right"], "right")

    if op in _LIST_RIGHT_OPS:
        right = predicate["right"]
        if "value" in right and not isinstance(right["value"], list):
            raise PredicateError(f"operator {op!r} requires a list right operand")


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------

def _operand_value(operand: dict[str, Any], state: dict[str, Any]) -> Any:
    if "path" in operand:
        return _resolve_path(operand["path"], state)
    return operand["value"]


def _coerce_pair(left: Any, right: Any, case_insensitive: bool) -> tuple[Any, Any]:
    if case_insensitive:
        if isinstance(left, str):
            left = left.lower()
        if isinstance(right, str):
            right = right.lower()
        elif isinstance(right, list):
            right = [r.lower() if isinstance(r, str) else r for r in right]
    return left, right


def _compare(op: str, left: Any, right: Any) -> bool:
    """Apply one allowlisted operator. Never raises on type mismatch."""
    try:
        if op == "eq":
            return left == right
        if op == "ne":
            return left != right
        if op == "lt":
            return left < right
        if op == "lte":
            return left <= right
        if op == "gt":
            return left > right
        if op == "gte":
            return left >= right
        if op == "contains":
            return right in left
        if op == "not_contains":
            return right not in left
        if op == "starts_with":
            return isinstance(left, str) and left.startswith(right)
        if op == "ends_with":
            return isinstance(left, str) and left.endswith(right)
        if op == "in":
            return left in right
        if op == "not_in":
            return left not in right
    except TypeError:
        # Comparing incompatible types is a False result, not a crash — a
        # condition node must never take down a run.
        return False
    raise PredicateError(f"unknown operator {op!r}")


def evaluate(predicate: dict[str, Any], state: dict[str, Any]) -> bool:
    """Evaluate a predicate against workflow state.

    Assumes validate_predicate() has already passed. Returns a bool; never
    raises for data reasons.
    """
    if "all" in predicate:
        return all(evaluate(child, state) for child in predicate["all"])
    if "any" in predicate:
        return any(evaluate(child, state) for child in predicate["any"])
    if "not" in predicate:
        return not evaluate(predicate["not"], state)

    op = predicate["op"]
    left = _operand_value(predicate["left"], state)

    if op == "is_empty":
        return left is None or left == "" or left == [] or left == {}
    if op == "is_not_empty":
        return not (left is None or left == "" or left == [] or left == {})
    if op == "is_true":
        return left is True
    if op == "is_false":
        return left is False

    right = _operand_value(predicate["right"], state)
    left, right = _coerce_pair(left, right, bool(predicate.get("case_insensitive")))
    return _compare(op, left, right)


def referenced_paths(predicate: Any) -> list[str]:
    """Every state path a predicate reads. Used by graph validation."""
    if not isinstance(predicate, dict):
        return []
    found: list[str] = []
    for key in ("all", "any"):
        if key in predicate and isinstance(predicate[key], list):
            for child in predicate[key]:
                found.extend(referenced_paths(child))
    if "not" in predicate:
        found.extend(referenced_paths(predicate["not"]))
    for side in ("left", "right"):
        operand = predicate.get(side)
        if isinstance(operand, dict) and isinstance(operand.get("path"), str):
            found.append(operand["path"])
    return found
