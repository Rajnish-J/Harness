import { Suspense } from "react";

import ChatDeepLink from "@/components/chat/ChatDeepLink";
import ChatWindow from "@/components/chat/ChatWindow";

export default function Home() {
  return (
    <>
      {/* useSearchParams must be inside a Suspense boundary or `next build`
          fails outright whenever this route is prerendered. */}
      <Suspense fallback={null}>
        <ChatDeepLink />
      </Suspense>
      <ChatWindow />
    </>
  );
}
