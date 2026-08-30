/**
 * DTOs for the credential vault.
 *
 * Same split as lib/registry-types.ts: dates cross the wire as ISO strings, so
 * these are not the Drizzle row types.
 *
 * The one rule that shapes every type here: NO type in this file has a field
 * holding a decrypted secret. `Credential` is what both the list and the detail
 * endpoint return, and neither carries the token — `lastFour` is the only trace
 * of it that ever reaches the browser. A token is write-only from the UI's point
 * of view: you can replace it, never read it back.
 */

export type CredentialProvider = "github" | "azure_devops" | "gitlab" | "generic";

export const CREDENTIAL_PROVIDERS: CredentialProvider[] = [
  "github",
  "azure_devops",
  "gitlab",
  "generic",
];

export const PROVIDER_LABELS: Record<CredentialProvider, string> = {
  github: "GitHub",
  azure_devops: "Azure DevOps",
  gitlab: "GitLab",
  generic: "Generic",
};

/**
 * What every endpoint returns. There is deliberately no richer "detail" variant:
 * the extra field a detail endpoint would add is the secret, and that is exactly
 * what must not be served.
 */
export type Credential = {
  id: string;
  name: string;
  provider: CredentialProvider;
  username: string | null;
  lastFour: string;
  scopes: string[];
  enabled: boolean;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CredentialInput = {
  name: string;
  provider?: CredentialProvider;
  username?: string | null;
  /** Plaintext on the way in only. Encrypted before it reaches the database. */
  secret?: string;
  enabled?: boolean;
};

/** The result of pressing "Test connection". */
export type CredentialTestResult = {
  ok: boolean;
  username: string | null;
  scopes: string[];
  message: string;
};

/** How a token is rendered anywhere it is shown. */
export function maskToken(lastFour: string): string {
  return `••••${lastFour}`;
}
