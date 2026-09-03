import CredentialsExplorer from "@/components/credentials/CredentialsExplorer";
import PageBody from "@/components/shell/PageBody";
import type { Credential } from "@/lib/credential-types";
import type { EnvVarListRow } from "@/lib/env-var-types";
import type { ModelCredential } from "@/lib/model-credential-types";
import type { ProjectOption } from "@/components/credentials/NewEnvVarDialog";
import { listCredentials } from "@/lib/server/credential-service";
import { describeDbError } from "@/lib/server/db-error";
import { listEnvVars } from "@/lib/server/env-var-service";
import { listModelCredentials } from "@/lib/server/model-credential-service";
import { listProjects } from "@/lib/server/project-service";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  let credentials: Credential[] = [];
  let envVars: EnvVarListRow[] = [];
  let modelCredentials: ModelCredential[] = [];
  let projects: ProjectOption[] = [];
  let error: string | null = null;

  try {
    // Four queries in one round trip, one per tab plus the projects list. That
    // last one is here for the "which project?" pickers, not to be rendered —
    // the env var rows already carry the project name they were joined against.
    const [credentialRows, envVarRows, modelRows, projectRows] = await Promise.all([
      listCredentials(),
      listEnvVars(),
      listModelCredentials(),
      listProjects(),
    ]);
    credentials = credentialRows;
    envVars = envVarRows;
    modelCredentials = modelRows;
    projects = projectRows;
  } catch (err) {
    error = `Could not load credentials: ${describeDbError(err)}`;
  }

  return (
    <PageBody width="wide">
      <CredentialsExplorer
        credentials={credentials}
        envVars={envVars}
        modelCredentials={modelCredentials}
        projects={projects}
        error={error}
      />
    </PageBody>
  );
}
