import { SkeletonEditor } from "@/components/registry/Skeletons";

/** The credential editor, while getCredential() runs. */
export default function Loading() {
  return <SkeletonEditor fields={5} />;
}
