import { Suspense } from "react";

import ChatEntryRedirect from "@/components/chat/ChatEntryRedirect";
import ChatWindowSkeleton from "@/components/chat/ChatWindowSkeleton";

export const dynamic = "force-dynamic";

/**
 * The chat entry point.
 *
 * Conversations live at /chat/<id> now, so this route holds no chat of its
 * own: it works out which one the browser had open and forwards to it. The
 * skeleton is what the user sees for the frame or two that takes.
 */
export default function Home() {
  return (
    <>
      {/* useSearchParams must be inside a Suspense boundary or `next build`
          fails outright whenever this route is prerendered. */}
      <Suspense fallback={null}>
        <ChatEntryRedirect />
      </Suspense>
      <ChatWindowSkeleton />
    </>
  );
}
