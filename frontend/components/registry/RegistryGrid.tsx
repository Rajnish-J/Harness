import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import EmptyState from "@/components/registry/EmptyState";
import ResourceCard, { type CardTone } from "@/components/registry/ResourceCard";
import LoadErrorToast from "@/components/shell/LoadErrorToast";
import { Button } from "@/components/ui/button";

/**
 * The card body shared by /mcp, /skills, /agents and /credentials.
 *
 * Same job the row list did — error banner, empty state, or linked entries —
 * so a new registry section is still one page file. Only the presentation
 * changed: cards in a reflowing grid instead of stacked rows.
 *
 * /projects no longer comes through here. A project carries a clone status, a
 * branch, a file count and its own row actions, which is more than a
 * `RegistryRow` can say — see components/projects/ProjectsExplorer.tsx. Both
 * still render the same `ResourceCard`, so the two pages cannot drift visually.
 */
export type RegistryRow = {
  id: string;
  title: string;
  /** The line under the title: a transport, a slug, a model. */
  kind?: string | null;
  /** The description line above the rule. */
  meta?: string | null;
  enabled: boolean;
};

export default function RegistryGrid({
  rows,
  error,
  href,
  icon,
  tone,
  empty,
}: {
  rows: RegistryRow[];
  error: string | null;
  /** Builds the detail link for a row id. */
  href: (id: string) => string;
  icon: LucideIcon;
  tone?: CardTone;
  empty: { title: string; description?: string; action?: React.ReactNode };
}) {
  if (error) {
    return (
      <>
        <LoadErrorToast title="Could not load the list" description={error} />
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <li key={row.id}>
          <ResourceCard
            icon={icon}
            tone={tone}
            title={row.title}
            kind={row.kind}
            meta={row.meta}
            disabled={!row.enabled}
            // The dot the project cards use, so a disabled MCP server and a
            // half-cloned project read the same way at a glance.
            status={
              row.enabled
                ? { tone: "ok", label: "Enabled" }
                : { tone: "idle", label: "Disabled" }
            }
            action={
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href={href(row.id)}>Manage</Link>
              </Button>
            }
          />
        </li>
      ))}
    </ul>
  );
}
