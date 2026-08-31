"use client";

import { FolderGit2 } from "lucide-react";
import { useCallback, useState } from "react";

import DeleteProjectDialog from "@/components/projects/DeleteProjectDialog";
import EditProjectDialog from "@/components/projects/EditProjectDialog";
import NewProjectDialog from "@/components/projects/NewProjectDialog";
import ProjectCard from "@/components/projects/ProjectCard";
import ProjectsTable from "@/components/projects/table/ProjectsTable";
import EmptyState from "@/components/registry/EmptyState";
import SectionHeader from "@/components/registry/SectionHeader";
import ViewSwitch, {
  VIEW_MODES,
  type ViewMode,
} from "@/components/registry/ViewSwitch";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import type { Credential } from "@/lib/credential-types";
import type { ProjectListRow } from "@/lib/project-types";

/**
 * The Projects page body: header, layout switch, and whichever view is chosen.
 *
 * A client component because all three pieces of state it owns — the view mode
 * and the two dialogs — are browser state, and because the table's sorting and
 * selection have nowhere to live on the server. The page above it stays a
 * server component and still does its three queries in one round trip.
 *
 * Both dialogs are mounted once here rather than once per row. With ~50 projects
 * that is fifty fewer Radix portals, and it is what lets the table's bulk delete
 * reuse the single-project dialog unchanged.
 */
export default function ProjectsExplorer({
  rows,
  credentials,
  error,
}: {
  rows: ProjectListRow[];
  credentials: Credential[];
  error: string | null;
}) {
  const [view, setView] = useStoredPreference<ViewMode>(
    "projects_view",
    "grid",
    VIEW_MODES,
  );
  const [editing, setEditing] = useState<ProjectListRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectListRow[] | null>(null);

  // Stable identities: `buildProjectColumns` is memoised on these, and a fresh
  // function each render would rebuild every column on every keystroke in the
  // filter box.
  const onEdit = useCallback((project: ProjectListRow) => setEditing(project), []);
  const onDeleteOne = useCallback(
    (project: ProjectListRow) => setDeleting([project]),
    [],
  );
  const onDeleteMany = useCallback(
    (projects: ProjectListRow[]) => setDeleting(projects),
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Projects"
        hint="Working trees the agent can work inside — cloned from GitHub, or started blank. Open one to browse its code and work on it with the agent."
        action={
          <div className="flex items-center gap-2">
            {rows.length > 0 && !error && (
              <ViewSwitch value={view} onChange={setView} />
            )}
            <NewProjectDialog credentials={credentials} />
          </div>
        }
      />

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects yet"
          description="Start a blank project, or clone a GitHub repository to give the agent a real codebase to work in."
          action={<NewProjectDialog credentials={credentials} />}
        />
      ) : view === "grid" ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={project}
                onEdit={onEdit}
                onDelete={onDeleteOne}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ProjectsTable rows={rows} onEdit={onEdit} onDelete={onDeleteMany} />
      )}

      {/* Keyed and conditionally mounted so each dialog seeds its fields from
          props on mount. Opening a second project remounts rather than
          re-seeding through an effect. */}
      {editing && (
        <EditProjectDialog
          key={editing.id}
          project={editing}
          credentials={credentials}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}

      {deleting && deleting.length > 0 && (
        <DeleteProjectDialog
          key={deleting.map((project) => project.id).join(",")}
          projects={deleting}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
