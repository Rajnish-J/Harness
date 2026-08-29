import { NextResponse } from "next/server";

import { API_BASE } from "@/lib/api";
import type { CredentialTestResult } from "@/lib/credential-types";
import { getCredential, recordValidation } from "@/lib/server/credential-service";
import { reportDbError } from "@/lib/server/db-error";

/**
 * "Test connection" — does this token actually work?
 *
 * The round trip looks indirect, and the indirection is the point:
 *
 *   browser -> here -> Python (decrypts, calls GitHub) -> here (writes verdict)
 *
 * Python does the decrypting because keeping one decrypt path in the codebase
 * means one thing to audit. Python does NOT write the result, even though it has
 * the row in front of it, because `credentials` is a Next.js-owned table and the
 * one-writer-per-table rule in db/schema.ts is what keeps that readable.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const existing = await getCredential(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("POST /api/credentials/[id]/test", error) },
      { status: 500 },
    );
  }

  let result: CredentialTestResult;
  try {
    const res = await fetch(`${API_BASE}/api/credentials/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = (await res.json().catch(() => ({}))) as Partial<CredentialTestResult> & {
      error?: string;
    };

    if (!res.ok) {
      // A backend that is down, or has no encryption key, is an operator
      // problem — not a verdict on the token, so nothing is recorded.
      return NextResponse.json(
        { error: body.error ?? `Harness backend returned ${res.status}.` },
        { status: res.status === 503 ? 503 : 502 },
      );
    }

    result = {
      ok: Boolean(body.ok),
      username: body.username ?? null,
      scopes: body.scopes ?? [],
      message: body.message ?? (body.ok ? "Token is valid." : "Token was rejected."),
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

  // A rejected token is a real verdict worth persisting: the list page shows it
  // so a stale PAT is visible without re-testing every credential by hand.
  try {
    const updated = await recordValidation(id, {
      username: result.username,
      scopes: result.scopes,
      error: result.ok ? null : result.message,
    });
    return NextResponse.json({ ...result, credential: updated });
  } catch (error) {
    // The test itself succeeded; failing to record it should not look like a
    // failed test.
    return NextResponse.json({
      ...result,
      warning: reportDbError("POST /api/credentials/[id]/test (record)", error),
    });
  }
}
