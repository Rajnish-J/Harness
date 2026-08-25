"""Structural validation of a workflow graph.

Returns structured issues rather than raising, so the canvas can highlight the
offending node or edge instead of showing a bare exception string.

Pure module: no I/O, no LangGraph, no LLM.
"""

from dataclasses import asdict, dataclass
from typing import Literal

from app.agent.tools.registry import TOOLS_BY_NAME
from app.workflow.conditions import PredicateError, validate_predicate
from app.workflow.schema import WorkflowGraph, WorkflowNode
from app.workflow.templating import referenced_node_ids, validate_template

Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    severity: Severity
    message: str
    node_id: str | None = None
    edge_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class GraphInvalid(Exception):
    """A graph failed validation. Carries the issues for the API layer."""

    def __init__(self, issues: list[ValidationIssue]) -> None:
        super().__init__(f"{len(issues)} validation issue(s)")
        self.issues = issues


def find_entry_nodes(graph: WorkflowGraph) -> list[str]:
    targets = {edge.target for edge in graph.edges}
    return [node.id for node in graph.nodes if node.id not in targets]


def _reachable_from(graph: WorkflowGraph, start: str) -> set[str]:
    adjacency: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    for edge in graph.edges:
        if edge.source in adjacency:
            adjacency[edge.source].append(edge.target)

    seen: set[str] = set()
    stack = [start]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(adjacency.get(current, []))
    return seen


def _all_guaranteed_ancestors(graph: WorkflowGraph) -> dict[str, set[str]]:
    """For every node: which nodes must have completed before it runs.

    The rule follows LangGraph's actual trigger semantics, which were measured
    rather than assumed:

    * A node fires on ANY incoming trigger, so with unequal path lengths a
      fan-in node runs once per arriving branch. The compiler therefore marks
      every multi-input node `defer=True`, which makes it run exactly once
      after all pending work — verified empirically.
    * Given defer, all **plain** predecessors have therefore completed, so they
      union in.
    * **Conditional** predecessors are different: only the taken branch runs.
      When every way in is conditional, only what those branches have in common
      is guaranteed, so they intersect.

    Conservative by construction: it may under-claim, never over-claim, except
    inside a cycle where the monotonic fixpoint can include a node's own
    back-edge peers. That only ever adds permissiveness in graphs that are
    already re-entrant, and self is always removed.
    """
    node_ids = [node.id for node in graph.nodes]
    known = set(node_ids)
    plain: dict[str, list[str]] = {nid: [] for nid in node_ids}
    conditional: dict[str, list[str]] = {nid: [] for nid in node_ids}

    for edge in graph.edges:
        if edge.target not in known or edge.source not in known:
            continue
        bucket = conditional if edge.branch is not None else plain
        bucket[edge.target].append(edge.source)

    ancestors: dict[str, set[str]] = {nid: set() for nid in node_ids}

    # Monotonic fixpoint from empty; converges because sets only grow.
    for _ in range(len(node_ids) + 1):
        changed = False
        for nid in node_ids:
            plain_preds, cond_preds = plain[nid], conditional[nid]
            if not plain_preds and not cond_preds:
                continue

            if plain_preds:
                # These all ran (defer guarantees it).
                merged = set()
                for pred in plain_preds:
                    merged |= {pred} | ancestors[pred]
            else:
                # Only one branch ran — take what they share.
                sets = [{pred} | ancestors[pred] for pred in cond_preds]
                merged = set.intersection(*sets) if sets else set()

            merged.discard(nid)
            if merged != ancestors[nid]:
                ancestors[nid] = merged
                changed = True
        if not changed:
            break

    return ancestors


def guaranteed_ancestors(graph: WorkflowGraph, node_id: str) -> set[str]:
    """Nodes that must have completed before `node_id` can run."""
    return _all_guaranteed_ancestors(graph).get(node_id, set())


def validate_graph(graph: WorkflowGraph, *, max_nodes: int = 50) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    nodes_by_id = graph.node_by_id()
    known_ids = set(nodes_by_id)

    if not graph.nodes:
        return [ValidationIssue("empty_graph", "error", "The workflow has no nodes.")]

    if len(graph.nodes) > max_nodes:
        issues.append(
            ValidationIssue(
                "too_many_nodes",
                "error",
                f"{len(graph.nodes)} nodes exceeds the limit of {max_nodes}.",
            )
        )

    if len(known_ids) != len(graph.nodes):
        seen: set[str] = set()
        for node in graph.nodes:
            if node.id in seen:
                issues.append(
                    ValidationIssue(
                        "duplicate_node_id",
                        "error",
                        f"Duplicate node id {node.id!r}.",
                        node_id=node.id,
                    )
                )
            seen.add(node.id)

    # ---- edges -----------------------------------------------------------
    for edge in graph.edges:
        if edge.source not in known_ids:
            issues.append(
                ValidationIssue(
                    "edge_missing_source",
                    "error",
                    f"Edge leaves from unknown node {edge.source!r}.",
                    edge_id=edge.id or None,
                )
            )
        if edge.target not in known_ids:
            issues.append(
                ValidationIssue(
                    "edge_missing_target",
                    "error",
                    f"Edge points at unknown node {edge.target!r}.",
                    edge_id=edge.id or None,
                )
            )
        if edge.source == edge.target:
            issues.append(
                ValidationIssue(
                    "self_loop",
                    "error",
                    f"Node {edge.source!r} cannot connect to itself.",
                    node_id=edge.source,
                )
            )
        source = nodes_by_id.get(edge.source)
        if source and source.type == "condition" and edge.branch is None:
            issues.append(
                ValidationIssue(
                    "condition_edge_needs_branch",
                    "error",
                    f"Edge out of condition node {edge.source!r} must be labelled "
                    "'true' or 'false'.",
                    edge_id=edge.id or None,
                    node_id=edge.source,
                )
            )
        if source and source.type != "condition" and edge.branch is not None:
            issues.append(
                ValidationIssue(
                    "branch_on_plain_edge",
                    "warning",
                    f"Edge out of {edge.source!r} has a branch label but "
                    f"{edge.source!r} is not a condition node; it will be ignored.",
                    edge_id=edge.id or None,
                )
            )

    # ---- entry point -----------------------------------------------------
    entries = find_entry_nodes(graph)
    if not entries:
        issues.append(
            ValidationIssue(
                "no_entry_point",
                "error",
                "Every node has an incoming edge, so the workflow has no start. "
                "A cycle needs at least one node outside it to enter from.",
            )
        )
    elif len(entries) > 1:
        issues.append(
            ValidationIssue(
                "multiple_entry_points",
                "error",
                "Multiple starting nodes: "
                + ", ".join(repr(e) for e in sorted(entries))
                + ". Connect them to a single start.",
            )
        )

    # ---- reachability ----------------------------------------------------
    if len(entries) == 1:
        reachable = _reachable_from(graph, entries[0])
        for node in graph.nodes:
            if node.id not in reachable:
                issues.append(
                    ValidationIssue(
                        "unreachable_node",
                        "warning",
                        f"Node {node.id!r} can never run — nothing leads to it.",
                        node_id=node.id,
                    )
                )

    # ---- per-node config -------------------------------------------------
    # Computed once for the whole graph rather than per node.
    ancestors = _all_guaranteed_ancestors(graph) if len(entries) == 1 else None
    for node in graph.nodes:
        issues.extend(_validate_node(node, graph, known_ids, ancestors))

    return issues


def _validate_node(
    node: WorkflowNode,
    graph: WorkflowGraph,
    known_ids: set[str],
    ancestors: dict[str, set[str]] | None,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    if node.type == "agent":
        try:
            config = node.agent_config()
        except Exception as exc:  # noqa: BLE001 - surfaced as an issue
            return [
                ValidationIssue(
                    "bad_node_config", "error", str(exc), node_id=node.id
                )
            ]

        if not config.prompt.strip():
            issues.append(
                ValidationIssue(
                    "empty_prompt",
                    "error",
                    f"Agent node {node.label or node.id!r} has no prompt.",
                    node_id=node.id,
                )
            )

        for name in config.tools or []:
            if name not in TOOLS_BY_NAME:
                issues.append(
                    ValidationIssue(
                        "unknown_tool",
                        "error",
                        f"Unknown tool {name!r}. Available: "
                        + ", ".join(sorted(TOOLS_BY_NAME)),
                        node_id=node.id,
                    )
                )

        for problem in validate_template(config.prompt, known_ids):
            issues.append(
                ValidationIssue("bad_template_ref", "error", problem, node_id=node.id)
            )

        # THE super-step check. Everything triggered in the same super-step runs
        # concurrently, so a node cannot read a sibling's output — the reference
        # would silently render empty at run time. Catch it at edit time.
        if ancestors is not None:
            reachable_before = ancestors.get(node.id, set())
            for referenced in referenced_node_ids(config.prompt):
                if referenced in known_ids and referenced not in reachable_before:
                    issues.append(
                        ValidationIssue(
                            "template_ref_not_ancestor",
                            "error",
                            f"{{{{ {referenced}.output }}}} is not available here: "
                            f"{referenced!r} is not guaranteed to finish before "
                            f"{node.id!r} runs. Connect them in sequence.",
                            node_id=node.id,
                        )
                    )

    elif node.type == "condition":
        try:
            config = node.condition_config()
        except Exception as exc:  # noqa: BLE001
            return [
                ValidationIssue(
                    "bad_node_config", "error", str(exc), node_id=node.id
                )
            ]

        try:
            validate_predicate(config.predicate)
        except PredicateError as exc:
            issues.append(
                ValidationIssue(
                    "bad_predicate",
                    "error",
                    f"Condition {node.label or node.id!r}: {exc}",
                    node_id=node.id,
                )
            )

        branches = {edge.branch for edge in graph.outgoing(node.id)}
        if not branches:
            issues.append(
                ValidationIssue(
                    "condition_no_outputs",
                    "warning",
                    f"Condition node {node.id!r} has no outgoing edges; both "
                    "branches end the workflow.",
                    node_id=node.id,
                )
            )

    return issues


def errors_only(issues: list[ValidationIssue]) -> list[ValidationIssue]:
    return [issue for issue in issues if issue.severity == "error"]
