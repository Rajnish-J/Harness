import { NextResponse } from "next/server";

import { slugify } from "@/lib/registry-types";
import { reportDbError } from "@/lib/server/db-error";
import {
  createBlankProject,
  createGithubProject,
  listProjects,
} from "@/lib/server/project-service";
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
  let create: () => ReturnType<typeof createBlankProject | typeof createGithubProject>;
  let slug: string;

  try {
    const body = await readJsonBody(request);
    const kind = optionalText(body, "kind") || "github";

    if (kind === "blank") {
      const name = requiredString(body, "name");
      slug = (optionalText(body, "slug") ?? "").trim() || slugify(name);
      if (!slug) return badRequest("name must contain at least one letter or digit");

      const input = {
        kind: "blank" as const,
        name,
        slug,
        description: optionalString(body, "description"),
      };
      create = () => createBlankProject(input);
    } else if (kind === "github") {
      const repoOwner = requiredString(body, "repoOwner");
      const repoName = requiredString(body, "repoName");
      const repoUrl = requiredString(body, "repoUrl");

      // The remote is stored and later handed to `git clone`, so it is checked
      // rather than trusted: a file:// or ssh:// URL from a tampered request
      // body would make git read somewhere it should not.
      if (!/^https:\/\//i.test(repoUrl)) {
        return badRequest("repoUrl must be an https:// URL");
      }
      // A token in the URL would be persisted into .git/config by the clone.
      if (repoUrl.includes("@")) {
        return badRequest("repoUrl must not embed credentials");
      }

      const name = (optionalText(body, "name") ?? "").trim() || repoName;
      slug = (optionalText(body, "slug") ?? "").trim() || slugify(name);
      if (!slug) return badRequest("name must contain at least one letter or digit");

      const input = {
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
      create = () => createGithubProject(input);
    } else {
      return badRequest(`kind must be "blank" or "github"`);
    }
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    // Creates the row only. Setting up the working tree — `git init` for a
    // blank project, `git clone` for a GitHub one — is a separate call so the
    // UI has something to attach progress to and a failure leaves a row the
    // operator can retry rather than nothing at all.
    return NextResponse.json(await create(), { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `A project with the slug "${slug}" already exists.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/projects", error) },
      { status: 500 },
    );
  }
}
