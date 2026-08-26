"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { fetchTools, type ToolInfo } from "@/lib/workflow-api";

/**
 * Read-only view of the Python harness's tool registry.
 *
 * Fetched in the browser for the same reason the sidebar's config line is:
 * API_BASE is the harness as the *browser* sees it, and a server-side fetch
 * would block the page render on Python being up. fetchTools already returns
 * [] rather than throwing when the harness is unreachable.
 */
export default function ToolsBrowser() {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchTools(controller.signal).then(setTools);
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    if (!tools) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle),
    );
  }, [tools, query]);

  if (tools === null) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">Loading tools…</p>
    );
  }

  if (tools.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No tools reported. Tools are registered in the Python harness
        (backend/app/agent/tools/registry.py) — check that it is running.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${tools.length} tools`}
          className="pl-8"
        />
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing matches “{query}”.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {filtered.map((tool) => (
          <li
            key={tool.name}
            className="rounded-lg border px-3 py-2.5"
          >
            <p className="font-mono text-sm font-medium">{tool.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">
                Input schema
              </summary>
              <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-[11px]">
                {JSON.stringify(tool.input_schema, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
