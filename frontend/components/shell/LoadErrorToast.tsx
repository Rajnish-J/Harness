"use client";

import { useEffect } from "react";

import { toast } from "@/components/ui/toast";

/**
 * Fires one toast for a page-load failure and renders nothing.
 *
 * The list pages that need this (workflows, and RegistryGrid for
 * mcp/skills/agents/credentials) are server components — they can `await` the
 * database directly, which is why the error string is already resolved by the
 * time it gets here — so the toast call itself has to live in a client leaf
 * like this one. The inline banner these pages already render stays alongside
 * it: a dismissed toast should not be the only trace that something failed.
 */
export default function LoadErrorToast({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  useEffect(() => {
    toast.error({ title, description });
    // Fire once per mount (a fresh error from a fresh server render), not on
    // every render this string happens to be stable across.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
