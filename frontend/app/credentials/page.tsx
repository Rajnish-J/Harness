import { KeyRound } from "lucide-react";

import NewCredentialButton from "@/components/credentials/NewCredentialButton";
import RegistryGrid from "@/components/registry/RegistryGrid";
import SectionHeader from "@/components/registry/SectionHeader";
import PageBody from "@/components/shell/PageBody";
import { maskToken, PROVIDER_LABELS } from "@/lib/credential-types";
import { listCredentials } from "@/lib/server/credential-service";
import { describeDbError } from "@/lib/server/db-error";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  let credentials: Awaited<ReturnType<typeof listCredentials>> = [];
  let error: string | null = null;

  try {
    credentials = await listCredentials();
  } catch (err) {
    error = `Could not load credentials: ${describeDbError(err)}`;
  }

  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Credentials"
          hint="Personal access tokens for GitHub and friends. Encrypted at rest, and never shown again once saved — only replaced."
          action={<NewCredentialButton />}
        />
        <RegistryGrid
          error={error}
          href={(id) => `/credentials/${id}`}
          icon={KeyRound}
          tone="green"
          empty={{
            title: "No credentials yet",
            description:
              "Add a GitHub personal access token to start cloning repositories into projects.",
            action: <NewCredentialButton />,
          }}
          rows={credentials.map((credential) => ({
            id: credential.id,
            title: credential.name,
            kind: `${PROVIDER_LABELS[credential.provider]} · ${maskToken(credential.lastFour)}`,
            // The card says what the last test found, so a token that expired
            // months ago is visible without opening every credential in turn.
            meta: credential.lastValidationError
              ? `Last test failed: ${credential.lastValidationError}`
              : credential.lastValidatedAt
                ? `Verified as ${credential.username ?? "an account"}`
                : "Not tested yet",
            enabled: credential.enabled,
          }))}
        />
      </div>
    </PageBody>
  );
}
