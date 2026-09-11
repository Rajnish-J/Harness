import { Suspense } from "react";

import ChatDeepLink from "@/components/chat/ChatDeepLink";
import ChatRouteSession from "@/components/chat/ChatRouteSession";
import ChatWindow from "@/components/chat/ChatWindow";

export const dynamic = "force-dynamic";

/**
 * One conversation.
 *
 * Unlike every other [id] route in this app, this one does NOT load its record
 * and call notFound() on a miss -- and that is deliberate. A chat id is a
 * namespace the client mints, not a registry row: the backend creates the row
 * lazily on the first message, so a brand-new chat legitimately has nothing to
 * find. Refusing to render it would 404 the "New chat" button. An id with no
 * rows is simply an empty conversation with a live composer, and it becomes a
 * real one the moment the user sends something.
 *
 * That also means there is nothing to await here, so the transcript is loaded
 * client-side by the session provider in the root layout -- ChatRouteSession
 * is the wire between this segment and it.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <ChatRouteSession id={id} />
      {/* useSearchParams must be inside a Suspense boundary or `next build`
          fails outright whenever this route is prerendered. */}
      <Suspense fallback={null}>
        <ChatDeepLink />
      </Suspense>
      <ChatWindow />
    </>
  );
}
