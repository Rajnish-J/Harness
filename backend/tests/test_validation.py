"""Graph validation, especially the super-step ancestor rule."""

from app.workflow.schema import WorkflowGraph
from app.workflow.validation import (
    find_entry_nodes,
    guaranteed_ancestors,
    validate_graph,
)


def agent(node_id, prompt="do the thing", tools=None, label=""):
    return {
        "id": node_id,
        "type": "agent",
        "label": label or node_id,
        "config": {"prompt": prompt, **({"tools": tools} if tools else {})},
    }


def condition(node_id, predicate=None):
    return {
        "id": node_id,
        "type": "condition",
        "config": {
            "predicate": predicate
            or {"left": {"path": "outputs.n1.status"}, "op": "eq",
                "right": {"value": "ok"}}
        },
    }


def edge(source, target, branch=None):
    return {"id": f"{source}->{target}", "source": source, "target": target,
            "branch": branch}


def codes(graph_dict, severity=None):
    graph = WorkflowGraph.model_validate(graph_dict)
    issues = validate_graph(graph)
    return {i.code for i in issues if severity is None or i.severity == severity}


def test_valid_two_node_graph_has_no_errors():
    g = {
        "nodes": [agent("n1", "write a spec"), agent("n2", "critique {{ n1.output }}")],
        "edges": [edge("n1", "n2")],
    }
    assert codes(g, "error") == set()


def test_empty_graph():
    assert "empty_graph" in codes({"nodes": [], "edges": []})


def test_multiple_entry_points():
    g = {"nodes": [agent("a"), agent("b")], "edges": []}
    assert "multiple_entry_points" in codes(g)


def test_no_entry_point_when_everything_is_a_cycle():
    g = {"nodes": [agent("a"), agent("b")],
         "edges": [edge("a", "b"), edge("b", "a")]}
    assert "no_entry_point" in codes(g)


def test_edge_to_missing_node():
    g = {"nodes": [agent("a")], "edges": [edge("a", "ghost")]}
    assert "edge_missing_target" in codes(g)


def test_self_loop():
    g = {"nodes": [agent("a")], "edges": [edge("a", "a")]}
    assert "self_loop" in codes(g)


def test_unknown_tool():
    g = {"nodes": [agent("a", tools=["rm_rf"])], "edges": []}
    assert "unknown_tool" in codes(g)


def test_empty_prompt():
    g = {"nodes": [agent("a", prompt="   ")], "edges": []}
    assert "empty_prompt" in codes(g)


def test_template_ref_to_unknown_node():
    g = {"nodes": [agent("a", "use {{ ghost.output }}")], "edges": []}
    assert "bad_template_ref" in codes(g)


def test_bad_predicate_surfaces_as_issue():
    g = {
        "nodes": [agent("n1"), condition("c1", {"left": {"path": "x"}, "op": "regex",
                                                "right": {"value": ".*"}})],
        "edges": [edge("n1", "c1")],
    }
    assert "bad_predicate" in codes(g)


def test_condition_edge_needs_branch_label():
    g = {
        "nodes": [agent("n1"), condition("c1"), agent("n2")],
        "edges": [edge("n1", "c1"), edge("c1", "n2")],  # no branch
    }
    assert "condition_edge_needs_branch" in codes(g)


def test_unreachable_node_is_a_warning():
    g = {
        "nodes": [agent("a"), agent("b"), agent("c")],
        "edges": [edge("a", "b"), edge("c", "b")],
    }
    # `c` has no inbound edge so it reads as a second entry point
    assert "multiple_entry_points" in codes(g)


# --------------------------------------------------------------------------
# The super-step rule
# --------------------------------------------------------------------------

def test_sibling_reference_is_rejected():
    """p1 and p2 run in the SAME super-step, so p2 cannot read p1's output."""
    g = {
        "nodes": [
            agent("start", "kick off"),
            agent("p1", "branch one"),
            agent("p2", "use {{ p1.output }}"),  # illegal: sibling, not ancestor
        ],
        "edges": [edge("start", "p1"), edge("start", "p2")],
    }
    assert "template_ref_not_ancestor" in codes(g)


def test_sequential_reference_is_allowed():
    g = {
        "nodes": [agent("n1", "write"), agent("n2", "read {{ n1.output }}")],
        "edges": [edge("n1", "n2")],
    }
    assert "template_ref_not_ancestor" not in codes(g)


def test_fan_in_reference_is_allowed():
    """join runs after BOTH branches, so it may read either."""
    g = {
        "nodes": [
            agent("start", "kick off"),
            agent("p1", "branch one"),
            agent("p2", "branch two"),
            agent("join", "combine {{ p1.output }} and {{ p2.output }}"),
        ],
        "edges": [
            edge("start", "p1"), edge("start", "p2"),
            edge("p1", "join"), edge("p2", "join"),
        ],
    }
    assert "template_ref_not_ancestor" not in codes(g)


def test_reference_across_a_conditional_branch_is_rejected():
    """b only runs on the true branch, so c (on false) can't depend on it."""
    g = {
        "nodes": [
            agent("n1", "start"),
            condition("c1"),
            agent("b", "true branch"),
            agent("c", "false branch using {{ b.output }}"),
        ],
        "edges": [
            edge("n1", "c1"),
            edge("c1", "b", "true"),
            edge("c1", "c", "false"),
        ],
    }
    assert "template_ref_not_ancestor" in codes(g)


def test_guaranteed_ancestors_intersects_paths():
    g = WorkflowGraph.model_validate({
        "nodes": [agent("start"), agent("p1"), agent("p2"), agent("join")],
        "edges": [
            edge("start", "p1"), edge("start", "p2"),
            edge("p1", "join"), edge("p2", "join"),
        ],
    })
    assert guaranteed_ancestors(g, "join") == {"start", "p1", "p2"}
    assert guaranteed_ancestors(g, "p1") == {"start"}
    assert guaranteed_ancestors(g, "start") == set()
    assert find_entry_nodes(g) == ["start"]


def test_guaranteed_ancestors_terminates_on_a_cycle():
    g = WorkflowGraph.model_validate({
        "nodes": [agent("a"), agent("b"), agent("c")],
        "edges": [edge("a", "b"), edge("b", "c"), edge("c", "b")],
    })
    assert "a" in guaranteed_ancestors(g, "c")
