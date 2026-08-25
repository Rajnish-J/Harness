"""Turn a stored graph document into a compiled LangGraph StateGraph.

The only module in the codebase that imports StateGraph.
"""

import logging

from langgraph.graph import END, START, StateGraph

from app.workflow.nodes.agent_node import NodeDeps, make_agent_node
from app.workflow.nodes.condition_node import make_condition_node, make_condition_router
from app.workflow.schema import WorkflowGraph
from app.workflow.state import WorkflowState
from app.workflow.validation import GraphInvalid, errors_only, find_entry_nodes, validate_graph

logger = logging.getLogger(__name__)


def build_state_graph(
    graph: WorkflowGraph,
    deps: NodeDeps,
    *,
    max_nodes: int = 50,
) -> StateGraph:
    """Compile a validated graph document. Raises GraphInvalid if it isn't."""
    issues = validate_graph(graph, max_nodes=max_nodes)
    fatal = errors_only(issues)
    if fatal:
        raise GraphInvalid(fatal)

    builder = StateGraph(WorkflowState)
    nodes_by_id = graph.node_by_id()

    # A node fires on ANY incoming trigger, so a fan-in node with unequal path
    # lengths runs once per arriving branch — measured, not assumed. defer=True
    # makes it run exactly once after all pending work, which is what anyone
    # drawing a diamond on a canvas expects. It also makes the validator's
    # "guaranteed ancestors" rule true.
    inbound_counts: dict[str, int] = {node_id: 0 for node_id in nodes_by_id}
    for edge in graph.edges:
        if edge.target in inbound_counts:
            inbound_counts[edge.target] += 1

    for node in graph.nodes:
        if node.type == "agent":
            fn = make_agent_node(node, deps)
        elif node.type == "condition":
            fn = make_condition_node(node, deps)
        else:  # pragma: no cover - schema restricts the literal
            raise GraphInvalid([])
        builder.add_node(node.id, fn, defer=inbound_counts[node.id] > 1)

    # Plain edges. Condition-node outlets are wired separately below.
    for edge in graph.edges:
        source = nodes_by_id.get(edge.source)
        if source is not None and source.type == "condition":
            continue
        builder.add_edge(edge.source, edge.target)

    for node in graph.nodes:
        if node.type != "condition":
            continue
        path_map: dict[str, str] = {}
        for edge in graph.outgoing(node.id):
            if edge.branch is not None:
                path_map[edge.branch] = edge.target
        # An unwired outlet ends the run rather than dead-ending the graph.
        path_map.setdefault("true", END)
        path_map.setdefault("false", END)
        builder.add_conditional_edges(node.id, make_condition_router(node), path_map)

    entry = find_entry_nodes(graph)[0]
    builder.add_edge(START, entry)

    # Terminal nodes (no outgoing edges) need an explicit END or the run hangs.
    for node in graph.nodes:
        if node.type != "condition" and not graph.outgoing(node.id):
            builder.add_edge(node.id, END)

    return builder
