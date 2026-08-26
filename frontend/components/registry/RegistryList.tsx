import Link from "next/link";

/**
 * The list body shared by /mcp, /skills and /agents.
 *
 * All three render the same thing: an error banner, an empty state, or rows
 * that link to a detail page. Keeping it in one place is the point of the
 * whole exercise — the previous pattern was to copy the markup per page.
 */
export type RegistryRow = {
  id: string;
  title: string;
  subtitle?: string | null;
  /** Short right-aligned label: a slug, a transport, a model. */
  badge?: string | null;
  enabled: boolean;
};

export default function RegistryList({
  rows,
  error,
  href,
  emptyMessage,
}: {
  rows: RegistryRow[];
  error: string | null;
  /** Builds the detail link for a row id. */
  href: (id: string) => string;
  emptyMessage: string;
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={href(row.id)}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                {row.title}
                {!row.enabled && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    disabled
                  </span>
                )}
              </p>
              {row.subtitle && (
                <p className="truncate text-xs text-muted-foreground">{row.subtitle}</p>
              )}
            </div>
            {row.badge && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {row.badge}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
