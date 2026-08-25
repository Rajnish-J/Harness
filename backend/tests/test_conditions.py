"""The condition DSL must be safe by construction, not by careful use."""

import pytest

from app.workflow.conditions import (
    PredicateError,
    evaluate,
    referenced_paths,
    validate_predicate,
)

STATE = {
    "input": "build a url shortener",
    "outputs": {
        "n1": {"status": "ok", "text": "Wrote spec.md with 5 sections."},
        "n2": {"status": "error", "text": "", "error": "boom"},
    },
    "errors": ["boom"],
}


def p(**kwargs):
    return kwargs


# --------------------------------------------------------------------------
# Injection attempts — every one of these must be REFUSED, never evaluated
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "predicate",
    [
        # Reaching into the Python object graph
        p(left={"path": "__class__.__mro__"}, op="eq", right={"value": 1}),
        p(left={"path": "outputs.__class__"}, op="eq", right={"value": 1}),
        p(left={"path": "__import__"}, op="eq", right={"value": 1}),
        # Operators outside the allowlist
        p(left={"path": "input"}, op="regex", right={"value": ".*"}),
        p(left={"path": "input"}, op="exec", right={"value": "rm -rf /"}),
        p(left={"path": "input"}, op="__eq__", right={"value": 1}),
        # A raw expression string where a predicate belongs
        "outputs['n1']['status'] == 'ok'",
        {"expr": "1 == 1"},
        # Untagged operand — the ambiguity that invites injection
        p(left="input", op="eq", right="x"),
        # Both tags at once
        p(left={"path": "input", "value": "x"}, op="eq", right={"value": "y"}),
        # Neither tag
        p(left={}, op="eq", right={"value": "y"}),
        # Path syntax abuse
        p(left={"path": "outputs.n1.text; import os"}, op="eq", right={"value": 1}),
        p(left={"path": "a..b"}, op="eq", right={"value": 1}),
        p(left={"path": ""}, op="eq", right={"value": 1}),
    ],
)
def test_rejects_injection(predicate):
    with pytest.raises(PredicateError):
        validate_predicate(predicate)


def test_rejects_unary_with_right_operand():
    with pytest.raises(PredicateError):
        validate_predicate(p(left={"path": "input"}, op="is_empty", right={"value": 1}))


def test_rejects_binary_without_right_operand():
    with pytest.raises(PredicateError):
        validate_predicate(p(left={"path": "input"}, op="eq"))


def test_rejects_in_with_non_list_right():
    with pytest.raises(PredicateError):
        validate_predicate(p(left={"path": "input"}, op="in", right={"value": "abc"}))


def test_rejects_runaway_nesting():
    deep = p(left={"path": "input"}, op="is_true")
    for _ in range(15):
        deep = {"not": deep}
    with pytest.raises(PredicateError):
        validate_predicate(deep)


# --------------------------------------------------------------------------
# Valid predicates evaluate correctly
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "predicate,expected",
    [
        (p(left={"path": "outputs.n1.status"}, op="eq", right={"value": "ok"}), True),
        (p(left={"path": "outputs.n2.status"}, op="eq", right={"value": "ok"}), False),
        (p(left={"path": "outputs.n1.text"}, op="contains", right={"value": "spec.md"}), True),
        (p(left={"path": "outputs.n1.text"}, op="starts_with", right={"value": "Wrote"}), True),
        (p(left={"path": "outputs.n2.text"}, op="is_empty"), True),
        (p(left={"path": "outputs.n1.text"}, op="is_not_empty"), True),
        (p(left={"path": "outputs.n1.status"}, op="in", right={"value": ["ok", "skipped"]}), True),
        (p(left={"path": "outputs.n2.status"}, op="not_in", right={"value": ["ok"]}), True),
        # Missing paths resolve to None, not an error
        (p(left={"path": "outputs.nope.status"}, op="is_empty"), True),
        (p(left={"path": "outputs.nope.status"}, op="eq", right={"value": "ok"}), False),
        # Case insensitivity
        (p(left={"path": "outputs.n1.status"}, op="eq", right={"value": "OK"},
           case_insensitive=True), True),
    ],
)
def test_evaluates(predicate, expected):
    validate_predicate(predicate)
    assert evaluate(predicate, STATE) is expected


def test_boolean_combinators():
    both_ok = {
        "all": [
            p(left={"path": "outputs.n1.status"}, op="eq", right={"value": "ok"}),
            p(left={"path": "outputs.n2.status"}, op="eq", right={"value": "ok"}),
        ]
    }
    either_ok = {
        "any": [
            p(left={"path": "outputs.n1.status"}, op="eq", right={"value": "ok"}),
            p(left={"path": "outputs.n2.status"}, op="eq", right={"value": "ok"}),
        ]
    }
    validate_predicate(both_ok)
    validate_predicate(either_ok)
    assert evaluate(both_ok, STATE) is False
    assert evaluate(either_ok, STATE) is True
    assert evaluate({"not": either_ok}, STATE) is False


def test_type_mismatch_is_false_not_crash():
    pred = p(left={"path": "outputs.n1.text"}, op="lt", right={"value": 5})
    validate_predicate(pred)
    assert evaluate(pred, STATE) is False


def test_referenced_paths():
    pred = {
        "all": [
            p(left={"path": "outputs.n1.status"}, op="eq", right={"value": "ok"}),
            {"not": p(left={"path": "outputs.n2.text"}, op="is_empty")},
        ]
    }
    assert set(referenced_paths(pred)) == {"outputs.n1.status", "outputs.n2.text"}
