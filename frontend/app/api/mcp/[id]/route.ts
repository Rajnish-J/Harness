import { NextResponse } from "next/server";

import { MCP_TRANSPORTS, type McpTransport } from "@/lib/registry-types";
import { reportDbError } from "@/lib/server/db-error";
import {
  deleteMcpServer,
  getMcpServer,
  updateMcpServer,
} from "@/lib/server/registry-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  optionalStringMap,
  readJsonBody,
  optionalText,
} from "@/lib/server/request";

// Next 16: route params arrive as a Promise and must be awaited.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    // The detail endpoint returns env/header values in full; the list endpoint
    // never does. See the comment on the `env` column in db/schema.ts.
    const row = await getMcpServer(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/mcp/[id]", error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let patch;
  try {
    const body = await readJsonBody(request);

    let transport: McpTransport | undefined;
    if ("transport" in body) {
      transport = body.transport as McpTransport;
      if (!MCP_TRANSPORTS.includes(transport)) {
        return badRequest(`transport must be one of ${MCP_TRANSPORTS.join(", ")}`);
      }
    }

    patch = {
      ...(optionalText(body, "name") !== undefined
        ? { name: optionalText(body, "name") }
        : {}),
      ...("description" in body
        ? { description: optionalString(body, "description") }
        : {}),
      ...(transport ? { transport } : {}),
      ...("command" in body ? { command: optionalString(body, "command") } : {}),
      ...("args" in body ? { args: optionalStringArray(body, "args") } : {}),
      ...("url" in body ? { url: optionalString(body, "url") } : {}),
      ...("env" in body ? { env: optionalStringMap(body, "env") } : {}),
      ...("headers" in body ? { headers: optionalStringMap(body, "headers") } : {}),
      ...("enabled" in body ? { enabled: optionalBoolean(body, "enabled") } : {}),
    };

    if (patch.name !== undefined && !patch.name.trim()) {
      return badRequest("name cannot be empty");
    }
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    const row = await updateMcpServer(id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Another MCP server already uses that name." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("PATCH /api/mcp/[id]", error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    // Hard delete: nothing holds a foreign key onto this table.
    const row = await deleteMcpServer(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: row.id });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("DELETE /api/mcp/[id]", error) },
      { status: 500 },
    );
  }
}
