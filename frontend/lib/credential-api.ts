/**
 * Browser client for the credential routes.
 *
 * Same-origin Next.js route handlers, like lib/registry-api.ts. Not built on
 * that file's `crud()` helper: credentials have a `test` verb it does not model,
 * and no endpoint here returns a "full" record distinct from the summary — the
 * field that would distinguish them is the secret, which never leaves the server.
 */

import type {
  Credential,
  CredentialInput,
  CredentialTestResult,
} from "./credential-types";

const BASE = "/api/credentials";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export const credentialsApi = {
  list: async (): Promise<Credential[]> =>
    json(await fetch(BASE, { cache: "no-store" })),

  get: async (id: string): Promise<Credential> =>
    json(await fetch(`${BASE}/${id}`, { cache: "no-store" })),

  create: async (input: CredentialInput & { secret: string }): Promise<Credential> =>
    json(
      await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),

  /**
   * Omit `secret` to keep the stored token. The editor cannot show it, so it
   * only ever sends the field when the operator has typed a replacement.
   */
  update: async (id: string, patch: Partial<CredentialInput>): Promise<Credential> =>
    json(
      await fetch(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    ),

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) await json(res);
  },

  test: async (
    id: string,
  ): Promise<CredentialTestResult & { credential?: Credential }> =>
    json(await fetch(`${BASE}/${id}/test`, { method: "POST" })),
};
