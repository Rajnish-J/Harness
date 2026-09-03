/**
 * Browser client for the model credential routes.
 *
 * Same-origin relative paths: these are Next.js route handlers backed by
 * Drizzle, unlike lib/api.ts which talks to the Python harness at API_BASE.
 * Same split as lib/registry-api.ts.
 */

import type {
  ModelCredential,
  ModelCredentialInput,
  ModelCredentialTestResult,
} from "./model-credential-types";

const BASE = "/api/model-credentials";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export const modelCredentialsApi = {
  list: async (): Promise<ModelCredential[]> =>
    json(await fetch(BASE, { cache: "no-store" })),

  get: async (id: string): Promise<ModelCredential> =>
    json(await fetch(`${BASE}/${id}`, { cache: "no-store" })),

  create: async (
    input: ModelCredentialInput & { secret: string },
  ): Promise<ModelCredential> =>
    json(
      await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),

  update: async (
    id: string,
    patch: Partial<ModelCredentialInput>,
  ): Promise<ModelCredential> =>
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

  /**
   * Ask the harness to spend the key once. Resolves with the verdict — a
   * rejected key is `{ ok: false }`, not a thrown error, matching the backend's
   * own split between "the key is bad" and "the check could not run".
   */
  test: async (
    id: string,
  ): Promise<ModelCredentialTestResult & { credential?: ModelCredential }> =>
    json(await fetch(`${BASE}/${id}/test`, { method: "POST" })),
};
