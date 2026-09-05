import { Skeleton } from "@/components/ui/skeleton";
import PageBody from "@/components/shell/PageBody";

/**
 * The /workflows list, while listWorkflows() runs.
 *
 * Rows, not cards: this is the one list page that renders bordered link rows
 * rather than the shared card grid, so it gets its own shape.
 */
export default function Loading() {
  return (
    <PageBody toolbar={<Skeleton className="h-8 w-32" />}>
      <ul className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i}>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-3 w-8 shrink-0" />
            </div>
          </li>
        ))}
      </ul>
    </PageBody>
  );
}
