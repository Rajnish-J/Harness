"use client";

import { useEffect, useState } from "react";

import { fetchConfig } from "@/lib/api";
import type { HarnessConfig } from "@/lib/types";

/**
 * The provider/model line that used to live in the chat header.
 *
 * Fetched in the browser, not on the server: API_BASE comes from
 * NEXT_PUBLIC_API_BASE_URL and points at the harness as the *browser* sees it.
 * A server-side fetch would also block every page render on Python being up.
 */
export default function HarnessStatus() {
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then(setConfig)
      .finally(() => setSettled(true));
    return () => controller.abort();
  }, []);

  return (
    <div className="px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">
      {config ? (
        <>
          <p className="truncate">
            {config.provider} · {config.model}
          </p>
          <p>max {config.max_iterations} iterations</p>
        </>
      ) : (
        <p>{settled ? "harness core offline" : "connecting to harness core…"}</p>
      )}
    </div>
  );
}
