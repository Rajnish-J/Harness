import { Skeleton } from "@/components/ui/skeleton";

/**
 * The workflow canvas, while getWorkflow() runs.
 *
 * A canvas has no rows to mimic, so this is the chrome around it plus a single
 * large surface — enough to hold the layout still until the graph arrives.
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-4 w-44" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}
