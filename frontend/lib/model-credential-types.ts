/**
 * DTOs for the LLM provider key vault.
 *
 * Same rule that shapes lib/credential-types.ts applies here and matters more:
 * NO type in this file has a field holding a decrypted API key. `ModelCredential`
 * is what both the list and the detail endpoint return, and neither carries the
 * secret — `lastFour` is the only trace of it that ever reaches the browser. A
 * key is write-only from the UI's point of view: you can replace it, never read
 * it back.
 */

export type ModelProvider = "anthropic" | "openai" | "groq";

export const MODEL_PROVIDERS: ModelProvider[] = ["anthropic", "openai", "groq"];

export const MODEL_PROVIDER_LABELS: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  groq: "Groq",
};

/**
 * Where to get a key, shown as a hint under the secret field. Typing an API key
 * is the one step of this flow that happens outside the app, so the console URL
 * is worth carrying rather than making the operator search for it.
 */
export const MODEL_PROVIDER_CONSOLES: Record<ModelProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  groq: "https://console.groq.com/keys",
};

/** The shape of a key, so an obvious paste error is caught before a round trip. */
export const MODEL_PROVIDER_KEY_PREFIXES: Record<ModelProvider, string | null> = {
  anthropic: "sk-ant-",
  openai: "sk-",
  // Groq issues `gsk_...`, but has shipped other shapes; not worth rejecting on.
  groq: null,
};

export type ModelCredential = {
  id: string;
  provider: ModelProvider;
  label: string | null;
  lastFour: string;
  baseUrl: string | null;
  extraModels: string[];
  enabled: boolean;
  validatedModels: string[];
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelCredentialInput = {
  provider: ModelProvider;
  label?: string | null;
  /** Plaintext on the way in only. Encrypted before it reaches the database. */
  secret?: string;
  baseUrl?: string | null;
  extraModels?: string[];
  enabled?: boolean;
};

/** The result of pressing "Test key". */
export type ModelCredentialTestResult = {
  ok: boolean;
  models: string[];
  message: string;
};

/** How a key is rendered anywhere it is shown. */
export function maskKey(lastFour: string): string {
  return `••••${lastFour}`;
}

/** The name to show for a credential: the operator's, else the provider's. */
export function credentialLabel(credential: ModelCredential): string {
  return credential.label?.trim() || MODEL_PROVIDER_LABELS[credential.provider];
}
