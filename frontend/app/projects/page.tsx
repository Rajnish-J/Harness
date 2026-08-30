import { FolderGit2 } from "lucide-react";

import NewProjectDialog from "@/components/projects/NewProjectDialog";
import RegistryGrid from "@/components/registry/RegistryGrid";
import SectionHeader from "@/components/registry/SectionHeader";
import PageBody from "@/components/shell/PageBody";
import type { Credential } from "@/lib/credential-types";
import { projectStatusLabel } from "@/lib/project-types";
import { listCredentials } from "@/lib/server/credential-service";
import { describeDbError } from "@/lib/server/db-error";
import { fileCountsByProject, listProjects } from "@/lib/server/project-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  let projects: Awaited<ReturnType<typeof listProjects>> = [];
  let credentials: Credential[] = [];
  let counts = new Map<string, number>();
  let error: string | null = null;

  try {
    // One grouped count query rather than one per card.
    [projects, credentials, counts] = await Promise.all([
      listProjects(),
      listCredentials(),
      fileCountsByProject(),
    ]);
  } catch (err) {
    error = `Could not load projects: ${describeDbError(err)}`;
  }

  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Projects"
          hint="Working trees the agent can work inside — cloned from GitHub, or started blank. Open one to browse its code and work on it with the agent."
          action={<NewProjectDialog credentials={credentials} />}
        />
        <RegistryGrid
          error={error}
          href={(id) => `/projects/${id}/vscode`}
          icon={FolderGit2}
          tone="sky"
          empty={{
            title: "No projects yet",
            description:
              "Start a blank project, or clone a GitHub repository to give the agent a real codebase to work in.",
            action: <NewProjectDialog credentials={credentials} />,
          }}
          rows={projects.map((project) => {
            const files = counts.get(project.id) ?? 0;
            return {
              id: project.id,
              title: project.name,
              kind:
                project.repoOwner && project.repoName
                  ? `${project.repoOwner}/${project.repoName}`
                  : "Blank project",
              // A failed setup says so on the card: the operator should not
              // have to open a project to discover it never finished.
              meta:
                project.cloneStatus === "error"
                  ? `${project.kind === "blank" ? "Setup" : "Clone"} failed: ${project.cloneError ?? "unknown error"}`
                  : project.cloneStatus === "ready"
                    ? `${files} files · ${project.currentBranch ?? project.defaultBranch}`
                    : projectStatusLabel(project),
              // Greys out anything not ready to open, reusing the card's
              // existing disabled treatment rather than inventing a new one.
              enabled: project.cloneStatus === "ready",
            };
          })}
        />
      </div>
    </PageBody>
  );
}
