import { SkeletonEditor } from "@/components/registry/Skeletons";

/**
 * The MCP server editor, while it loads.
 *
 * This is where the catalog wizard lands after adding a server. That page runs
 * two sequential database queries, and with no boundary to render into, the
 * navigation used to sit on the previous screen with no feedback at all.
 */
export default function Loading() {
  return <SkeletonEditor fields={7} />;
}
