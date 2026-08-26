import { NextResponse } from "next/server";

import { reportDbError } from "@/lib/server/db-error";
import { deleteAgent, getAgent, updateAgent } from "@/lib/server/registry-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalPositiveInt,
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
    const row = await getAgent(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/agents/[id]", error) },
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
      ...("systemPrompt" in body
        ? { systemPrompt: optionalText(body, "systemPrompt") }
        : {}),
      ...("model" in body ? { model: optionalString(body, "model") } : {}),
      ...("maxIterations" in body
        ? { maxIterations: optionalPositiveInt(body, "maxIterations") }
        : {}),
      ...("toolNames" in body
        ? { toolNames: optionalStringArray(body, "toolNames") }
        : {}),
      ...("skillIds" in body
        ? { skillIds: optionalStringArray(body, "skillIds") }
        : {}),
      ...("mcpServerIds" in body
        ? { mcpServerIds: optionalStringArray(body, "mcpServerIds") }
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
    const row = await updateAgent(id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Another agent already uses that slug." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("PATCH /api/agents/[id]", error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    // Hard delete: nothing holds a foreign key onto this table.
    const row = await deleteAgent(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: row.id });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("DELETE /api/agents/[id]", error) },
      { status: 500 },
    );
  }
}
