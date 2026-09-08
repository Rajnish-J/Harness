import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/registry/Skeletons";

/**
 * The project IDE, while it loads.
 *
 * The slowest page in the app to open: it awaits the project row, then a
 * cross-service fetch to the Python harness for the chat transcript, before
 * anything renders. Left unmasked that reads as a hang, so this draws the shell
 * the IDE will occupy — toolbar strip, file rail, editor pane — rather than a
 * centred spinner, which would say nothing about what is arriving.
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-24" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r">
          <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
            <Skeleton className="h-5 w-24" />
          </div>
          <SkeletonRows count={8} height="h-5" className="gap-1 p-2" />
        </div>
        <div className="min-w-0 flex-1 p-4">
          <SkeletonRows count={12} height="h-4" className="gap-2" />
        </div>
      </div>
    </div>
  );
}
