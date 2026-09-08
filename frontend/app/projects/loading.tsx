import {
  SkeletonCardGrid,
  SkeletonSectionHeader,
} from "@/components/registry/Skeletons";
import PageBody from "@/components/shell/PageBody";

/** The /projects grid, while its three queries run. */
export default function Loading() {
  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <SkeletonSectionHeader />
        <SkeletonCardGrid />
      </div>
    </PageBody>
  );
}
