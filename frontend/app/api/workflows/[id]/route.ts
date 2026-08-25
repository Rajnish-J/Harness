import { NextResponse } from "next/server";

import {
  archiveWorkflow,
  getWorkflow,
  updateWorkflow,
  validateGraph,
} from "@/lib/server/workflow-service";
import type { WorkflowGraph } from "@/lib/workflow-types";

// Next 16: route params arrive as a Promise and must be awaited.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await getWorkflow(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let body: { name?: string; description?: string | null; graph?: WorkflowGraph };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate before writing: the database should never hold a graph that
  // cannot execute.
  if (body.graph && body.graph.nodes.length > 0) {
    try {
      const result = await validateGraph(body.graph);
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
    const row = await updateWorkflow(id, body);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    // Soft delete — run history holds a restrict FK onto this row.
    const row = await archiveWorkflow(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, archived: row.id });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
