import { NextResponse } from "next/server";

import { reportDbError } from "@/lib/server/db-error";
import {
  createWorkflow,
  listWorkflows,
  validateGraph,
} from "@/lib/server/workflow-service";
import { EMPTY_GRAPH, type WorkflowGraph } from "@/lib/workflow-types";

// A freshly created workflow may legitimately be a set of disconnected nodes
// (e.g. several agents dropped in from the "New workflow" picker, not yet
// wired together) — these two codes describe exactly that shape and get
// resolved once the user connects the nodes, not by editing a node's config.
// Every other error still blocks creation.
const TOLERATED_AT_CREATION = new Set(["multiple_entry_points", "no_entry_point"]);

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

export async function GET() {
  try {
    return NextResponse.json(await listWorkflows());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/workflows", error) }, { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: { name?: string; description?: string; graph?: WorkflowGraph };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const graph = body.graph ?? EMPTY_GRAPH;

  // An empty graph is legitimately empty and fails validation ("no nodes"),
  // so only validate once there's something to check.
  if (graph.nodes.length > 0) {
    try {
      const result = await validateGraph(graph);
      const blocking = result.issues.filter(
        (issue) => issue.severity === "error" && !TOLERATED_AT_CREATION.has(issue.code),
      );
      if (blocking.length > 0) {
        return NextResponse.json(
          { error: "Graph is not valid", issues: blocking },
          { status: 422 },
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: `Could not reach the harness to validate: ${(error as Error).message}` },
        { status: 502 },
      );
    }
  }

  try {
    const row = await createWorkflow({ name, description: body.description, graph });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("POST /api/workflows", error) },
      { status: 500 },
    );
  }
}
