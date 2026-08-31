import ProjectsExplorer from "@/components/projects/ProjectsExplorer";
import PageBody from "@/components/shell/PageBody";
import type { Credential } from "@/lib/credential-types";
import type { ProjectListRow } from "@/lib/project-types";
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

  // Joined here rather than in the client component: the count is a server-side
  // query, and both the card and the table row want it on the same object.
  const rows: ProjectListRow[] = projects.map((project) => ({
    ...project,
    fileCount: counts.get(project.id) ?? 0,
  }));

  return (
    <PageBody width="wide">
      <ProjectsExplorer rows={rows} credentials={credentials} error={error} />
    </PageBody>
  );
}
