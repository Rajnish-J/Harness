import {
  SkeletonCardGrid,
  SkeletonSectionHeader,
} from "@/components/registry/Skeletons";
import PageBody from "@/components/shell/PageBody";

/** The /agents grid, while listAgents() runs. */
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
