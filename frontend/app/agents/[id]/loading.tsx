import { SkeletonEditor } from "@/components/registry/Skeletons";

/** The agent editor, while getAgent() runs. */
export default function Loading() {
  return <SkeletonEditor fields={6} />;
}
