import { NextResponse } from "next/server";

import { slugify } from "@/lib/registry-types";
import { reportDbError } from "@/lib/server/db-error";
import { createProject, listProjects } from "@/lib/server/project-service";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalString,
  optionalText,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

export async function GET() {
  try {
    return NextResponse.json(await listProjects());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/projects", error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let input;
  try {
    const body = await readJsonBody(request);
    const repoOwner = requiredString(body, "repoOwner");
    const repoName = requiredString(body, "repoName");
    const repoUrl = requiredString(body, "repoUrl");

    // The remote is stored and later handed to `git clone`, so it is checked
    // rather than trusted: a file:// or ssh:// URL from a tampered request body
    // would make git read somewhere it should not.
    if (!/^https:\/\//i.test(repoUrl)) {
      return badRequest("repoUrl must be an https:// URL");
    }
    // A token in the URL would be persisted into .git/config by the clone.
    if (repoUrl.includes("@")) {
      return badRequest("repoUrl must not embed credentials");
    }

    const name = (optionalText(body, "name") ?? "").trim() || repoName;
    const slug = (optionalText(body, "slug") ?? "").trim() || slugify(name);
    if (!slug) return badRequest("name must contain at least one letter or digit");

    input = {
      name,
      slug,
      repoOwner,
      repoName,
      repoUrl,
      repoId: optionalString(body, "repoId"),
      defaultBranch: optionalText(body, "defaultBranch") || "main",
      visibility: optionalText(body, "visibility") || "private",
      credentialId: optionalString(body, "credentialId"),
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    // Creates the row only. The clone is a separate, streamed call so the UI
    // has something to attach progress to and a failed clone leaves a row the
    // operator can retry rather than nothing at all.
    return NextResponse.json(await createProject(input), { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `A project with the slug "${input.slug}" already exists.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/projects", error) },
      { status: 500 },
    );
  }
}
