"use client";

import { FolderGit2, GitBranch, FileCode2 } from "lucide-react";
import Link from "next/link";

import ResourceCard, { type CardStatus } from "@/components/registry/ResourceCard";
import { Button } from "@/components/ui/button";
import ProjectActionsMenu from "@/components/projects/ProjectActionsMenu";
import type { ProjectListRow } from "@/lib/project-types";
import { projectStatusLabel } from "@/lib/project-types";

/**
 * How a project's clone state reads on a card or in a table cell.
 *
 * Shared by both views so a project cannot be "Ready" in the grid and something
 * else in the list. The wording still comes from `projectStatusLabel`, which
 * phrases it for how the project originated — a blank project was never
 * "cloned".
 */
export function projectStatus(project: ProjectListRow): CardStatus {
  const label =
    project.cloneStatus === "error"
      ? `${projectStatusLabel(project)}: ${project.cloneError ?? "unknown error"}`
      : projectStatusLabel(project);

  const tone =
    project.cloneStatus === "ready"
      ? "ok"
      : project.cloneStatus === "error"
        ? "error"
        : "warn";

  return { tone, label };
}

/** `owner/name`, or what a blank project shows instead. */
export function projectRepoLabel(project: ProjectListRow): string {
  return project.repoOwner && project.repoName
    ? `${project.repoOwner}/${project.repoName}`
    : "Blank project";
}

/**
 * One project in the grid.
 *
 * Composes ResourceCard rather than forking it: a project needs more on the
 * face of the card than a skill does — a branch, a file count, row actions —
 * but it sits in the same shell as every other registry page, and a card that
 * had drifted visually would read as a bug.
 */
export default function ProjectCard({
  project,
  onEdit,
  onDelete,
}: {
  project: ProjectListRow;
  onEdit: (project: ProjectListRow) => void;
  onDelete: (project: ProjectListRow) => void;
}) {
  const ready = project.cloneStatus === "ready";
  const branch = project.currentBranch ?? project.defaultBranch;

  return (
    <ResourceCard
      icon={FolderGit2}
      tone="sky"
      title={project.name}
      kind={projectRepoLabel(project)}
      status={projectStatus(project)}
      disabled={!ready}
      actions={
        <ProjectActionsMenu
          project={project}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      }
      meta={
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            <GitBranch className="size-3 shrink-0" aria-hidden />
            {branch}
          </span>
          {ready && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
              <FileCode2 className="size-3 shrink-0" aria-hidden />
              {project.fileCount.toLocaleString()}{" "}
              {project.fileCount === 1 ? "file" : "files"}
            </span>
          )}
        </span>
      }
      action={
        // Not a disabled-looking link: a project that never finished cloning has
        // no working tree, so the IDE behind this would open on nothing.
        ready ? (
          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link href={`/projects/${project.id}/vscode`}>Open</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled>
            Open
          </Button>
        )
      }
    />
  );
}
