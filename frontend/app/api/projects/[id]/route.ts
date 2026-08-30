import { NextResponse } from "next/server";

import { reportDbError } from "@/lib/server/db-error";
import {
  archiveProject,
  getProject,
  updateProject,
} from "@/lib/server/project-service";
import {
  BadRequest,
  badRequest,
  optionalString,
  optionalText,
  readJsonBody,
} from "@/lib/server/request";

// Next 16: route params arrive as a Promise and must be awaited.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await getProject(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/projects/[id]", error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let patch;
  try {
    const body = await readJsonBody(request);
    // Deliberately narrow. The repo coordinates describe what was cloned, and
    // cloneStatus is Python's to write — editing either here would let the row
    // disagree with the checkout on disk.
    patch = {
      ...("name" in body ? { name: optionalText(body, "name") } : {}),
      ...("credentialId" in body
        ? { credentialId: optionalString(body, "credentialId") }
        : {}),
      ...("defaultBranch" in body
        ? { defaultBranch: optionalText(body, "defaultBranch") }
        : {}),
    };

    if (patch.name !== undefined && !patch.name.trim()) {
      return badRequest("name cannot be empty");
    }
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    const row = await updateProject(id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("PATCH /api/projects/[id]", error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    // Soft delete: project_files cascades from this row and a container may be
    // running against the checkout. Archiving hides it without destroying
    // either; reclaiming the disk is a separate, deliberate step.
    const row = await archiveProject(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, archived: row.id });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("DELETE /api/projects/[id]", error) },
      { status: 500 },
    );
  }
}
