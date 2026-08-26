/**
 * The model picker's catalog, served by the Python harness.
 *
 * Fetched rather than hardcoded because only the harness knows which provider
 * is configured, and therefore which models are actually selectable. Failures
 * return an empty catalog for the same reason fetchTools does: the composer
 * must still render when Python is down.
 */

import { API_BASE } from "./api";
import { flags } from "./flags";
import { MOCK_MODEL_CATALOG } from "./mock/models";

export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  description: string;
  context_tokens: number | null;
  /** null where the harness has no price it is confident enough to show. */
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  /** False for models belonging to a provider this deployment is not running. */
  available: boolean;
  default: boolean;
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
  if (flags.mockChat) return MOCK_MODEL_CATALOG;

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
