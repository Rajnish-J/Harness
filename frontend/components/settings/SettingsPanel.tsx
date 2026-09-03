import { cn } from "@/lib/utils";

/**
 * The two primitives every settings tab is built from, extracted from
 * SettingsBrowser when that page grew tabs and four files started needing them.
 *
 * Deliberately dumb: a bordered box and a label/value line. Anything that has
 * to fetch, decide or persist belongs in the tab that owns it.
 */

export function Panel({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border">{children}</div>;
}

export function Row({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0">
      <div className="min-w-40">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div
        className={cn(
          "ml-auto max-w-full truncate text-sm text-muted-foreground",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The placeholder a panel shows when its data has not arrived. Split from the
 * loading case by `settled`: before the fetch resolves an empty panel means
 * "waiting", after it means the harness is not there.
 */
export function PanelEmpty({
  settled,
  loading,
  empty,
}: {
  settled: boolean;
  loading: string;
  empty: string;
}) {
  return (
    <p className="p-4 text-sm text-muted-foreground">
      {settled ? empty : loading}
    </p>
  );
}
