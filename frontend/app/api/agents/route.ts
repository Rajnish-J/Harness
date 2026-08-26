import { NextResponse } from "next/server";

import { slugify } from "@/lib/registry-types";
import { reportDbError } from "@/lib/server/db-error";
import { createAgent, listAgents } from "@/lib/server/registry-service";
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
  requiredString,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

export async function GET() {
  try {
    return NextResponse.json(await listAgents());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/agents", error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let input;
  try {
    const body = await readJsonBody(request);
    const name = requiredString(body, "name");
    const slug = (optionalText(body, "slug") ?? "").trim() || slugify(name);
    if (!slug) return badRequest("name must contain at least one letter or digit");

    input = {
      slug,
      name,
      description: optionalString(body, "description"),
      systemPrompt: optionalText(body, "systemPrompt"),
      model: optionalString(body, "model"),
      maxIterations: optionalPositiveInt(body, "maxIterations"),
      toolNames: optionalStringArray(body, "toolNames"),
      skillIds: optionalStringArray(body, "skillIds"),
      mcpServerIds: optionalStringArray(body, "mcpServerIds"),
      enabled: optionalBoolean(body, "enabled"),
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    return NextResponse.json(await createAgent(input), { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `An agent with the slug "${input.slug}" already exists.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/agents", error) },
      { status: 500 },
    );
  }
}
