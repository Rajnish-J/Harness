/**
 * The model picker's catalog, served by the Python harness.
 *
 * Fetched rather than hardcoded because only the harness knows which provider
 * keys are registered, and therefore which models are actually selectable.
 * Failures return an empty catalog for the same reason fetchTools does: the
 * composer must still render when Python is down.
 *
 * There is deliberately NO mock branch here, unlike streamChat beside it. A
 * fixture catalog used to stand in under NEXT_PUBLIC_MOCK_CHAT, and it actively
 * lied: it hardcoded four Anthropic models as available regardless of whether
 * any key existed, which is the exact question this endpoint now answers. Mock
 * chat still fakes the message stream; which models you may pick is always the
 * truth.
 */

import { API_BASE } from "./api";

export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  description: string;
  context_tokens: number | null;
  /** null where the harness has no price it is confident enough to show. */
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  /** False when no key is registered for this model's provider. */
  available: boolean;
  default: boolean;
  /** Where the key behind this model came from; null when there is none. */
  credential_source: "db" | "env" | null;
  /**
   * The verdict from that key's last test. `unknown` means registered but never
   * tested — not a failure. This is what lets the composer show an expired key
   * before a message is sent rather than after.
   */
  status: "ok" | "unknown" | "rejected" | "missing";
  /** The provider's own words on the last failure. */
  status_message: string | null;
  /** ISO timestamp of that test, or null. */
  checked_at: string | null;
};

export type ModelCatalog = {
  provider: string;
  default: string | null;
  pricing_as_of: string;
  models: ModelInfo[];
};

export const EMPTY_CATALOG: ModelCatalog = {
  provider: "",
  default: null,
  pricing_as_of: "",
  models: [],
};

export async function fetchModels(signal?: AbortSignal): Promise<ModelCatalog> {
  try {
    const res = await fetch(`${API_BASE}/api/models`, { signal });
    if (!res.ok) return EMPTY_CATALOG;
    return (await res.json()) as ModelCatalog;
  } catch {
    return EMPTY_CATALOG;
  }
}

/** "$5.00" — or an em dash where the harness reports no price. */
export function formatPrice(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

/** "1M" / "200K", for the context line under a model's description. */
export function formatContext(tokens: number | null): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  return `${Math.round(tokens / 1000)}K`;
}

/** Grouped by provider, preserving the catalog's own order within each group. */
export function groupByProvider(models: ModelInfo[]): [string, ModelInfo[]][] {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const bucket = groups.get(model.provider);
    if (bucket) bucket.push(model);
    else groups.set(model.provider, [model]);
  }
  return [...groups.entries()];
}

/** The short badge a model row carries, or null when there is nothing to say. */
export function statusBadge(
  model: ModelInfo,
): { label: string; tone: "ok" | "warn" | "error" } | null {
  if (!model.available) return { label: "no key", tone: "warn" };
  if (model.status === "rejected") return { label: "key failed", tone: "error" };
  if (model.status === "unknown") return { label: "untested", tone: "warn" };
  return null;
}
