import CredentialsExplorer from "@/components/credentials/CredentialsExplorer";
import PageBody from "@/components/shell/PageBody";
import type { Credential } from "@/lib/credential-types";
import type { EnvVarListRow } from "@/lib/env-var-types";
import type { ProjectOption } from "@/components/credentials/NewEnvVarDialog";
import { listCredentials } from "@/lib/server/credential-service";
import { describeDbError } from "@/lib/server/db-error";
import { listEnvVars } from "@/lib/server/env-var-service";
import { listProjects } from "@/lib/server/project-service";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  let credentials: Credential[] = [];
  let envVars: EnvVarListRow[] = [];
  let projects: ProjectOption[] = [];
  let error: string | null = null;

  try {
    // Three queries in one round trip. The projects list is here for the
    // "which project?" pickers, not to be rendered — the env var rows already
    // carry the project name they were joined against.
    const [credentialRows, envVarRows, projectRows] = await Promise.all([
      listCredentials(),
      listEnvVars(),
      listProjects(),
    ]);
    credentials = credentialRows;
    envVars = envVarRows;
    projects = projectRows;
  } catch (err) {
    error = `Could not load credentials: ${describeDbError(err)}`;
  }

  return (
    <PageBody width="wide">
      <CredentialsExplorer
        credentials={credentials}
        envVars={envVars}
        projects={projects}
        error={error}
      />
    </PageBody>
  );
}
