import { SkeletonEditor } from "@/components/registry/Skeletons";

/** The skill editor, while getSkill() runs. */
export default function Loading() {
  return <SkeletonEditor fields={5} />;
}
