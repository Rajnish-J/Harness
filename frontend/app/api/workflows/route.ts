import { NextResponse } from "next/server";

import { reportDbError } from "@/lib/server/db-error";
import {
  createWorkflow,
  listWorkflows,
  validateGraph,
} from "@/lib/server/workflow-service";
import { EMPTY_GRAPH, type WorkflowGraph } from "@/lib/workflow-types";

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

  // A brand new workflow is legitimately empty, and an empty graph fails
  // validation ("no nodes") — so only validate once there's something to check.
  if (graph.nodes.length > 0) {
    try {
      const result = await validateGraph(graph);
      if (!result.ok) {
        return NextResponse.json(
          { error: "Graph is not valid", issues: result.issues },
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
