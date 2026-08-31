import { NextResponse } from "next/server";

import { isValidEnvKey } from "@/lib/env-var-types";
import { CredentialCryptoError } from "@/lib/server/crypto";
import { reportDbError } from "@/lib/server/db-error";
import {
  createEnvVar,
  isLiveProject,
  listEnvVars,
} from "@/lib/server/env-var-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

export async function GET() {
  try {
    return NextResponse.json(await listEnvVars());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/project-env-vars", error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let input;
  try {
    const body = await readJsonBody(request);
    const key = requiredString(body, "key");
    if (!isValidEnvKey(key)) {
      return badRequest(
        `"${key}" is not a usable variable name — use letters, digits and underscores, starting with a letter or underscore.`,
      );
    }
    input = {
      projectId: requiredString(body, "projectId"),
      key,
      // Not `requiredString`: "" is a legitimate value for an env var, and
      // rejecting it would be a rule the shell itself does not have.
      value: typeof body.value === "string" ? body.value : "",
      secret: optionalBoolean(body, "secret"),
      description: optionalString(body, "description"),
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    // Checked here rather than left to the foreign key: a 23503 would surface as
    // an opaque 500, and "that project is gone" is a sentence worth saying.
    if (!(await isLiveProject(input.projectId))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(await createEnvVar(input), { status: 201 });
  } catch (error) {
    if (error instanceof CredentialCryptoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `${input.key} is already set on this project.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/project-env-vars", error) },
      { status: 500 },
    );
  }
}
