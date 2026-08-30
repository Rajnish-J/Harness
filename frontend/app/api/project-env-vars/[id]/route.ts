import { NextResponse } from "next/server";

import { isValidEnvKey } from "@/lib/env-var-types";
import { CredentialCryptoError } from "@/lib/server/crypto";
import { reportDbError } from "@/lib/server/db-error";
import {
  deleteEnvVar,
  getEnvVar,
  updateEnvVar,
} from "@/lib/server/env-var-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  optionalText,
  readJsonBody,
} from "@/lib/server/request";

// Next 16: route params arrive as a Promise and must be awaited.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await getEnvVar(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/project-env-vars/[id]", error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let patch;
  try {
    const body = await readJsonBody(request);

    if ("key" in body) {
      const key = optionalText(body, "key");
      if (key === undefined || !isValidEnvKey(key)) {
        return badRequest(
          "key must use letters, digits and underscores, starting with a letter or underscore.",
        );
      }
    }

    patch = {
      ...("key" in body ? { key: optionalText(body, "key") } : {}),
      // Present-and-empty means "set it to the empty string", which a `.env`
      // can hold. Only an absent field leaves the stored value alone.
      ...("value" in body ? { value: optionalText(body, "value") } : {}),
      ...("secret" in body ? { secret: optionalBoolean(body, "secret") } : {}),
      ...("description" in body
        ? { description: optionalString(body, "description") }
        : {}),
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    const row = await updateEnvVar(id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof CredentialCryptoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "That project already has a variable with this name." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("PATCH /api/project-env-vars/[id]", error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await deleteEnvVar(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: row.id });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("DELETE /api/project-env-vars/[id]", error) },
      { status: 500 },
    );
  }
}
