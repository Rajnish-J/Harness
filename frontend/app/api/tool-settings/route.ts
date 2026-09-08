import { NextResponse } from "next/server";

import { reportDbError } from "@/lib/server/db-error";
import {
  listDisabledTools,
  setToolsEnabled,
  ToolNameError,
} from "@/lib/server/tool-settings-service";
import {
  BadRequest,
  badRequest,
  readJsonBody,
  requiredBoolean,
  requiredStringArray,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

/**
 * The global tool disable list — the /tools page's source of truth.
 *
 * Both verbs answer with the same `{ disabled }` object rather than a bare
 * array, so a later field (a master "no tools at all" switch, say) is additive
 * rather than a breaking change to the response shape.
 */
export async function GET() {
  try {
    return NextResponse.json({ disabled: await listDisabledTools() });
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/tool-settings", error) },
      { status: 500 },
    );
  }
}

/**
 * Switch named tools on or off.
 *
 * PATCH rather than PUT: a PUT of the whole set would be read-modify-write in
 * the browser, and two tabs toggling different tools would silently drop one of
 * the changes. Naming only what changed makes the write an upsert of those rows.
 */
export async function PATCH(request: Request) {
  let names: string[];
  let enabled: boolean;
  try {
    const body = await readJsonBody(request);
    names = requiredStringArray(body, "names");
    enabled = requiredBoolean(body, "enabled");
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    return NextResponse.json({ disabled: await setToolsEnabled(names, enabled) });
  } catch (error) {
    // A name the caller made up is a client error, not a database failure.
    if (error instanceof ToolNameError) return badRequest(error.message);
    return NextResponse.json(
      { error: reportDbError("PATCH /api/tool-settings", error) },
      { status: 500 },
    );
  }
}
