"use client";

import { Braces, KeyRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import CredentialCard from "@/components/credentials/CredentialCard";
import DeleteCredentialDialog from "@/components/credentials/DeleteCredentialDialog";
import DeleteEnvVarDialog from "@/components/credentials/DeleteEnvVarDialog";
import EditEnvVarDialog from "@/components/credentials/EditEnvVarDialog";
import EnvVarCard from "@/components/credentials/EnvVarCard";
import NewCredentialButton from "@/components/credentials/NewCredentialButton";
import NewEnvVarDialog, {
  type ProjectOption,
} from "@/components/credentials/NewEnvVarDialog";
import CredentialsTable from "@/components/credentials/table/CredentialsTable";
import EnvVarsTable from "@/components/credentials/table/EnvVarsTable";
import EmptyState from "@/components/registry/EmptyState";
import SectionHeader from "@/components/registry/SectionHeader";
import ViewSwitch, {
  VIEW_MODES,
  type ViewMode,
} from "@/components/registry/ViewSwitch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import type { Credential } from "@/lib/credential-types";
import type { EnvVarListRow } from "@/lib/env-var-types";

const SCOPES = ["personal", "project"] as const;
type Scope = (typeof SCOPES)[number];

const ALL_PROJECTS = "__all__";

/**
 * The Credentials page body: two tabs over two different kinds of secret.
 *
 * They are tabs rather than two sections on one page because they answer
 * different questions and are managed at different times. A personal credential
 * is a token the HARNESS replays to GitHub on your behalf — one list, yours,
 * rarely touched. A project variable is a string the PROJECT reads at runtime —
 * dozens per project, grouped by the project that owns them. Stacking both
 * would put a fifty-row `.env` between you and the two tokens above it.
 *
 * Both tabs get the same grid/list switch as /projects, and each remembers its
 * own choice: the grid is the better read for a handful of tokens, the table
 * for comparing DATABASE_URL across three projects, and which you want depends
 * on which tab you are in.
 *
 * Every dialog is mounted once here rather than once per row — the same reason
 * ProjectsExplorer does it. With a hundred variables that is a hundred fewer
 * Radix portals, and it is what lets the table's bulk delete reuse the
 * single-row dialog unchanged.
 */
export default function CredentialsExplorer({
  credentials,
  envVars,
  projects,
  error,
}: {
  credentials: Credential[];
  envVars: EnvVarListRow[];
  projects: ProjectOption[];
  error: string | null;
}) {
  const [scope, setScope] = useStoredPreference<Scope>(
    "credentials_scope",
    "personal",
    SCOPES,
  );
  const [personalView, setPersonalView] = useStoredPreference<ViewMode>(
    "credentials_view",
    "grid",
    VIEW_MODES,
  );
  const [projectView, setProjectView] = useStoredPreference<ViewMode>(
    "project_env_view",
    "list",
    VIEW_MODES,
  );

  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [deletingCredentials, setDeletingCredentials] = useState<
    Credential[] | null
  >(null);
  const [editingEnvVar, setEditingEnvVar] = useState<EnvVarListRow | null>(null);
  const [deletingEnvVars, setDeletingEnvVars] = useState<EnvVarListRow[] | null>(
    null,
  );

  // Stable identities: the column factories are memoised on these, and a fresh
  // function each render would rebuild every column on every keystroke in the
  // filter box.
  const onDeleteCredentials = useCallback(
    (rows: Credential[]) => setDeletingCredentials(rows),
    [],
  );
  const onEditEnvVar = useCallback(
    (envVar: EnvVarListRow) => setEditingEnvVar(envVar),
    [],
  );
  const onDeleteEnvVars = useCallback(
    (rows: EnvVarListRow[]) => setDeletingEnvVars(rows),
    [],
  );

  const visibleEnvVars = useMemo(
    () =>
      projectFilter === ALL_PROJECTS
        ? envVars
        : envVars.filter((envVar) => envVar.projectId === projectFilter),
    [envVars, projectFilter],
  );

  /** The grid groups by project; the table does not — see EnvVarsTable. */
  const grouped = useMemo(() => {
    const byProject = new Map<string, EnvVarListRow[]>();
    for (const envVar of visibleEnvVars) {
      const bucket = byProject.get(envVar.projectId);
      if (bucket) bucket.push(envVar);
      else byProject.set(envVar.projectId, [envVar]);
    }
    return [...byProject.values()];
  }, [visibleEnvVars]);

  const projectSelect = (
    <Select value={projectFilter} onValueChange={setProjectFilter}>
      <SelectTrigger className="h-8 w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Credentials"
        hint="Tokens the harness uses on your behalf, and the environment variables your projects read at runtime. Everything here is encrypted at rest."
      />

      <Tabs value={scope} onValueChange={(next) => setScope(next as Scope)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList variant="line">
            <TabsTrigger value="personal">
              <KeyRound />
              Personal
              <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                {credentials.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="project">
              <Braces />
              Project
              <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                {envVars.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            {scope === "personal" ? (
              <>
                {credentials.length > 0 && (
                  <ViewSwitch value={personalView} onChange={setPersonalView} />
                )}
                <NewCredentialButton />
              </>
            ) : (
              <>
                {envVars.length > 0 && (
                  <ViewSwitch value={projectView} onChange={setProjectView} />
                )}
                <NewEnvVarDialog
                  projects={projects}
                  defaultProjectId={
                    projectFilter === ALL_PROJECTS ? undefined : projectFilter
                  }
                />
              </>
            )}
          </div>
        </div>

        <TabsContent value="personal" className="pt-4">
          {credentials.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No credentials yet"
              description="Add a GitHub personal access token to start cloning repositories into projects."
              action={<NewCredentialButton />}
            />
          ) : personalView === "grid" ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {credentials.map((credential) => (
                <li key={credential.id}>
                  <CredentialCard
                    credential={credential}
                    onDelete={(row) => onDeleteCredentials([row])}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <CredentialsTable
              rows={credentials}
              onDelete={onDeleteCredentials}
            />
          )}
        </TabsContent>

        <TabsContent value="project" className="pt-4">
          {projects.length === 0 ? (
            <EmptyState
              icon={Braces}
              title="No projects yet"
              description="Environment variables belong to a project. Create or import one first, then its .env lives here."
            />
          ) : envVars.length === 0 ? (
            <EmptyState
              icon={Braces}
              title="No project variables yet"
              description="Paste a .env to bring a project's configuration in all at once, or add variables one at a time."
              action={<NewEnvVarDialog projects={projects} />}
            />
          ) : projectView === "grid" ? (
            <div className="flex flex-col gap-6">
              {/* The filter lives beside the grid too, so switching views does
                  not silently widen what you were looking at. */}
              <div className="flex justify-end">{projectSelect}</div>

              {grouped.length === 0 ? (
                <EmptyState
                  icon={Braces}
                  title="Nothing for that project"
                  description="This project has no environment variables yet."
                />
              ) : (
                grouped.map((rows) => (
                  <section key={rows[0].projectId} className="flex flex-col gap-3">
                    <h3 className="flex items-baseline gap-2 text-sm font-semibold">
                      {rows[0].projectName}
                      <span className="text-xs font-normal text-muted-foreground tabular-nums">
                        {rows.length}
                      </span>
                    </h3>
                    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {rows.map((envVar) => (
                        <li key={envVar.id}>
                          <EnvVarCard
                            envVar={envVar}
                            onEdit={onEditEnvVar}
                            onDelete={(row) => onDeleteEnvVars([row])}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          ) : (
            <EnvVarsTable
              rows={visibleEnvVars}
              onEdit={onEditEnvVar}
              onDelete={onDeleteEnvVars}
              toolbar={projectSelect}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Keyed and conditionally mounted so each dialog seeds its fields from
          props on mount. Opening a second row remounts rather than re-seeding
          through an effect. */}
      {deletingCredentials && deletingCredentials.length > 0 && (
        <DeleteCredentialDialog
          key={deletingCredentials.map((row) => row.id).join(",")}
          credentials={deletingCredentials}
          onOpenChange={(open) => {
            if (!open) setDeletingCredentials(null);
          }}
        />
      )}

      {editingEnvVar && (
        <EditEnvVarDialog
          key={editingEnvVar.id}
          envVar={editingEnvVar}
          onOpenChange={(open) => {
            if (!open) setEditingEnvVar(null);
          }}
        />
      )}

      {deletingEnvVars && deletingEnvVars.length > 0 && (
        <DeleteEnvVarDialog
          key={deletingEnvVars.map((row) => row.id).join(",")}
          envVars={deletingEnvVars}
          onOpenChange={(open) => {
            if (!open) setDeletingEnvVars(null);
          }}
        />
      )}
    </div>
  );
}
