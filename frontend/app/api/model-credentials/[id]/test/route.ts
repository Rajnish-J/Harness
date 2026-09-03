import { NextResponse } from "next/server";

import { API_BASE } from "@/lib/api";
import type { ModelCredentialTestResult } from "@/lib/model-credential-types";
import { reportDbError } from "@/lib/server/db-error";
import {
  getModelCredential,
  recordModelValidation,
} from "@/lib/server/model-credential-service";

/**
 * "Test key" — can this key actually reach the provider?
 *
 * The same round trip the PAT vault uses, and the indirection is the point:
 *
 *   browser -> here -> Python (decrypts, calls the provider) -> here (records)
 *
 * Python does the decrypting because keeping one decrypt path in the codebase
 * means one thing to audit. Python does NOT write the result, even though it has
 * the row in front of it, because `model_credentials` is a Next.js-owned table
 * and the one-writer-per-table rule in db/schema.ts is what keeps that readable.
 *
 * This is also what makes an expired key visible in the composer's model picker
 * before a message is sent: the verdict recorded here is what /api/models reads
 * back out.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const existing = await getModelCredential(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("POST /api/model-credentials/[id]/test", error) },
      { status: 500 },
    );
  }

  let result: ModelCredentialTestResult;
  try {
    const res = await fetch(`${API_BASE}/api/model-credentials/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = (await res.json().catch(() => ({}))) as Partial<
      ModelCredentialTestResult
    > & { error?: string };

    if (!res.ok) {
      // A backend that is down, or has no encryption key, is an operator
      // problem — not a verdict on the key, so nothing is recorded.
      return NextResponse.json(
        { error: body.error ?? `Harness backend returned ${res.status}.` },
        { status: res.status === 503 ? 503 : 502 },
      );
    }

    result = {
      ok: Boolean(body.ok),
      models: body.models ?? [],
      message: body.message ?? (body.ok ? "Key is valid." : "Key was rejected."),
    };
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not reach the harness backend. Start it with " +
          "`uvicorn main:app --reload --port 8000` in backend/.",
      },
      { status: 502 },
    );
  }

  // A rejected key is a real verdict worth persisting: the model picker reads it
  // so an expired key is visible without testing every provider by hand.
  try {
    const updated = await recordModelValidation(id, {
      models: result.models,
      error: result.ok ? null : result.message,
    });
    return NextResponse.json({ ...result, credential: updated });
  } catch (error) {
    // The test itself succeeded; failing to record it should not look like a
    // failed test.
    return NextResponse.json({
      ...result,
      warning: reportDbError(
        "POST /api/model-credentials/[id]/test (record)",
        error,
      ),
    });
  }
}
