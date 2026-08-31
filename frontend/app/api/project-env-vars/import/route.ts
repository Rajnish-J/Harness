import { NextResponse } from "next/server";

import { isValidEnvKey, parseDotenv } from "@/lib/env-var-types";
import { CredentialCryptoError } from "@/lib/server/crypto";
import { reportDbError } from "@/lib/server/db-error";
import { importEnvVars, isLiveProject } from "@/lib/server/env-var-service";
import {
  BadRequest,
  badRequest,
  optionalBoolean,
  optionalText,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

/**
 * Bulk import from pasted `.env` text.
 *
 * A static segment, so it is reached before `[id]` — Next resolves literal
 * path segments ahead of dynamic ones, and there is no env var whose id is
 * the string "import".
 *
 * The text is re-parsed HERE rather than trusting the entries the paste box
 * already previewed. The dialog's preview is a convenience; this is the
 * boundary, and a client that posted `dotenv` straight from a script must get
 * the same validation as one that used the UI.
 */
export async function POST(request: Request) {
  let projectId: string;
  let entries: { key: string; value: string }[];
  let secret: boolean;

  try {
    const body = await readJsonBody(request);
    projectId = requiredString(body, "projectId");
    secret = optionalBoolean(body, "secret") ?? true;

    const dotenv = optionalText(body, "dotenv");
    if (dotenv === undefined) {
      return badRequest("dotenv is required");
    }
    entries = parseDotenv(dotenv);

    if (entries.length === 0) {
      return badRequest(
        "No variables found — expected lines like KEY=value.",
      );
    }
    // parseDotenv already drops these, so this is belt and braces against a
    // future change to it rather than a reachable branch today.
    const bad = entries.find((entry) => !isValidEnvKey(entry.key));
    if (bad) return badRequest(`"${bad.key}" is not a usable variable name.`);
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    if (!(await isLiveProject(projectId))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const rows = await importEnvVars(projectId, entries, { secret });
    return NextResponse.json({ imported: rows.length, rows }, { status: 201 });
  } catch (error) {
    if (error instanceof CredentialCryptoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/project-env-vars/import", error) },
      { status: 500 },
    );
  }
}
