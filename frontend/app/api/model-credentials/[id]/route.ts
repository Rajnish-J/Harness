import { NextResponse } from "next/server";

import {
  MODEL_PROVIDERS,
  type ModelProvider,
} from "@/lib/model-credential-types";
import { CredentialCryptoError } from "@/lib/server/crypto";
import {
  deleteModelCredential,
  getModelCredential,
  updateModelCredential,
} from "@/lib/server/model-credential-service";
import { reportDbError } from "@/lib/server/db-error";
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
    // Returns the same shape as the list endpoint. There is no "reveal" here:
    // the stored key is never served back, only replaced.
    const row = await getModelCredential(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/model-credentials/[id]", error) },
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
        !MODEL_PROVIDERS.includes(value as ModelProvider)
      ) {
        return badRequest(`provider must be one of: ${MODEL_PROVIDERS.join(", ")}`);
      }
    }

    patch = {
      ...("provider" in body ? { provider: body.provider as ModelProvider } : {}),
      ...("label" in body ? { label: optionalString(body, "label") } : {}),
      ...("secret" in body ? { secret: optionalText(body, "secret") } : {}),
      ...("baseUrl" in body ? { baseUrl: optionalString(body, "baseUrl") } : {}),
      ...("extraModels" in body
        ? { extraModels: optionalStringArray(body, "extraModels") }
        : {}),
      ...("enabled" in body ? { enabled: optionalBoolean(body, "enabled") } : {}),
    };

    // Sending "secret": "" would otherwise mean "replace the key with nothing".
    // Omit the field to keep the existing one.
    if (patch.secret !== undefined && !patch.secret.trim()) {
      return badRequest(
        "secret cannot be empty — omit the field entirely to keep the current key",
      );
    }
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    const row = await updateModelCredential(id, patch);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof CredentialCryptoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "A key for that provider is already registered." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("PATCH /api/model-credentials/[id]", error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await deleteModelCredential(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: row.id });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("DELETE /api/model-credentials/[id]", error) },
      { status: 500 },
    );
  }
}
