import { NextResponse } from "next/server";

import { MCP_TRANSPORTS, type McpTransport } from "@/lib/registry-types";
import { reportDbError } from "@/lib/server/db-error";
import { createMcpServer, listMcpServers } from "@/lib/server/registry-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  optionalStringMap,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

export async function GET() {
  try {
    return NextResponse.json(await listMcpServers());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/mcp", error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let input;
  try {
    const body = await readJsonBody(request);
    const transport = (body.transport ?? "stdio") as McpTransport;
    if (!MCP_TRANSPORTS.includes(transport)) {
      return badRequest(`transport must be one of ${MCP_TRANSPORTS.join(", ")}`);
    }

    input = {
      name: requiredString(body, "name"),
      description: optionalString(body, "description"),
      transport,
      command: optionalString(body, "command"),
      args: optionalStringArray(body, "args"),
      url: optionalString(body, "url"),
      env: optionalStringMap(body, "env"),
      headers: optionalStringMap(body, "headers"),
      enabled: optionalBoolean(body, "enabled"),
    };

    // A stdio server without a command, or an http server without a URL, is
    // unusable. Catching it here beats storing a connection that can't dial.
    if (transport === "stdio" && !input.command) {
      return badRequest("command is required for a stdio server");
    }
    if (transport !== "stdio" && !input.url) {
      return badRequest(`url is required for an ${transport} server`);
    }
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    return NextResponse.json(await createMcpServer(input), { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `An MCP server named "${input.name}" already exists.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/mcp", error) },
      { status: 500 },
    );
  }
}
