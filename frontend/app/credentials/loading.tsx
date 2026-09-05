import { SkeletonCardGrid } from "@/components/registry/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import PageBody from "@/components/shell/PageBody";

/**
 * The /credentials explorer, while its four queries run.
 *
 * The heaviest page in the app to open — credentials, env vars, model
 * credentials and projects are awaited together — so the tab strip is drawn
 * too, not just the grid. The tabs are the part that tells you where you are.
 */
export default function Loading() {
  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
          <Skeleton className="h-8 w-32" />
        </div>
        <SkeletonCardGrid />
      </div>
    </PageBody>
  );
}
