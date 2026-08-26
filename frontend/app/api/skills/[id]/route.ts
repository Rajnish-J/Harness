import { NextResponse } from "next/server";

import { reportDbError } from "@/lib/server/db-error";
import { deleteSkill, getSkill, updateSkill } from "@/lib/server/registry-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  optionalText,
  readJsonBody,
} from "@/lib/server/request";

// Next 16: route params arrive as a Promise and must be awaited.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await getSkill(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/skills/[id]", error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let patch;
  try {
    const body = await readJsonBody(request);
    patch = {
      ...("slug" in body ? { slug: optionalText(body, "slug") } : {}),
      ...("name" in body ? { name: optionalText(body, "name") } : {}),
      ...("description" in body
        ? { description: optionalString(body, "description") }
        : {}),
      ...("content" in body ? { content: optionalText(body, "content") } : {}),
      ...("allowedTools" in body
        ? { allowedTools: optionalStringArray(body, "allowedTools") }
        : {}),
      ...("enabled" in body ? { enabled: optionalBoolean(body, "enabled") } : {}),
    };

    if (patch.name !== undefined && !patch.name.trim()) {
      return badRequest("name cannot be empty");
    }
    if (patch.slug !== undefined && !patch.slug.trim()) {
      return badRequest("slug cannot be empty");
    }
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    const row = await updateSkill(id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Another skill already uses that slug." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("PATCH /api/skills/[id]", error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    // Hard delete. Agents reference skills by id in jsonb, not by foreign key,
    // so nothing blocks this — the agent editor drops ids that no longer
    // resolve when it renders.
    const row = await deleteSkill(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: row.id });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("DELETE /api/skills/[id]", error) },
      { status: 500 },
    );
  }
}
