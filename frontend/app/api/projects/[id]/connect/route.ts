import { NextResponse } from "next/server";

import { reportDbError } from "@/lib/server/db-error";
import { connectProjectToGithub } from "@/lib/server/project-service";
import {
  BadRequest,
  badRequest,
  optionalString,
  optionalText,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

// Next 16: route params arrive as a Promise and must be awaited.
type Ctx = { params: Promise<{ id: string }> };

/**
 * Link a Blank Project to a GitHub remote it hasn't been connected to yet.
 *
 * This only writes the row — same split as POST /api/projects and its
 * separate /clone call. The actual `git remote add` + push happens against
 * the Python harness, which is the only side with a decrypted token and a
 * working tree to push from.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  let input;
  try {
    const body = await readJsonBody(request);
    const repoOwner = requiredString(body, "repoOwner");
    const repoName = requiredString(body, "repoName");
    const repoUrl = requiredString(body, "repoUrl");
    const credentialId = requiredString(body, "credentialId");

    // Same checks as creating a GitHub project: this is stored and later
    // handed to git, so it is verified rather than trusted.
    if (!/^https:\/\//i.test(repoUrl)) {
      return badRequest("repoUrl must be an https:// URL");
    }
    if (repoUrl.includes("@")) {
      return badRequest("repoUrl must not embed credentials");
    }

    input = {
      repoOwner,
      repoName,
      repoUrl,
      repoId: optionalString(body, "repoId"),
      defaultBranch: optionalText(body, "defaultBranch") || "main",
      visibility: optionalText(body, "visibility") || "private",
      credentialId,
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    const row = await connectProjectToGithub(id, input);
    if (!row) {
      return NextResponse.json(
        {
          error:
            "Project not found, or it already has a repository linked to it.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("POST /api/projects/[id]/connect", error) },
      { status: 500 },
    );
  }
}
