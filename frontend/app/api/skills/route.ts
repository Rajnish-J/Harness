import { NextResponse } from "next/server";

import { slugify } from "@/lib/registry-types";
import { reportDbError } from "@/lib/server/db-error";
import { createSkill, listSkills } from "@/lib/server/registry-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  optionalText,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

export async function GET() {
  try {
    return NextResponse.json(await listSkills());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/skills", error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let input;
  try {
    const body = await readJsonBody(request);
    const name = requiredString(body, "name");
    // Derived from the name so the operator never has to type one.
    const slug = (optionalText(body, "slug") ?? "").trim() || slugify(name);
    if (!slug) return badRequest("name must contain at least one letter or digit");

    input = {
      slug,
      name,
      description: optionalString(body, "description"),
      content: optionalText(body, "content"),
      allowedTools: optionalStringArray(body, "allowedTools"),
      enabled: optionalBoolean(body, "enabled"),
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    return NextResponse.json(await createSkill(input), { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `A skill with the slug "${input.slug}" already exists.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/skills", error) },
      { status: 500 },
    );
  }
}
