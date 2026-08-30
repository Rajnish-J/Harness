import { NextResponse } from "next/server";

import { CREDENTIAL_PROVIDERS, type CredentialProvider } from "@/lib/credential-types";
import {
  deleteCredential,
  getCredential,
  updateCredential,
} from "@/lib/server/credential-service";
import { CredentialCryptoError } from "@/lib/server/crypto";
import { reportDbError } from "@/lib/server/db-error";
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
    // Returns the same shape as the list endpoint. There is no "reveal" here:
    // the stored token is never served back, only replaced.
    const row = await getCredential(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/credentials/[id]", error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let patch;
  try {
    const body = await readJsonBody(request);

    if ("provider" in body) {
      const value = body.provider;
      if (
        typeof value !== "string" ||
        !CREDENTIAL_PROVIDERS.includes(value as CredentialProvider)
      ) {
        return badRequest(`provider must be one of: ${CREDENTIAL_PROVIDERS.join(", ")}`);
      }
    }

    patch = {
      ...("name" in body ? { name: optionalText(body, "name") } : {}),
      ...("provider" in body
        ? { provider: body.provider as CredentialProvider }
        : {}),
      ...("username" in body ? { username: optionalString(body, "username") } : {}),
      ...("secret" in body ? { secret: optionalText(body, "secret") } : {}),
      ...("enabled" in body ? { enabled: optionalBoolean(body, "enabled") } : {}),
    };

    if (patch.name !== undefined && !patch.name.trim()) {
      return badRequest("name cannot be empty");
    }
    // Sending "secret": "" would otherwise mean "replace the token with nothing".
    // Omit the field to keep the existing one.
    if (patch.secret !== undefined && !patch.secret.trim()) {
      return badRequest(
        "secret cannot be empty — omit the field entirely to keep the current token",
      );
    }
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    const row = await updateCredential(id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof CredentialCryptoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Another credential already uses that name." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("PATCH /api/credentials/[id]", error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await deleteCredential(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: row.id });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("DELETE /api/credentials/[id]", error) },
      { status: 500 },
    );
  }
}
