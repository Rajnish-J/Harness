import {
  SkeletonCardGrid,
  SkeletonSectionHeader,
} from "@/components/registry/Skeletons";
import PageBody from "@/components/shell/PageBody";

/** The /skills grid, while listSkills() runs. */
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
