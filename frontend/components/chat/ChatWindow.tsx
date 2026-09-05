"use client";

import { cn } from "@/lib/utils";

import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import { useChatPreset } from "./ChatPresetProvider";
import { useChatSession } from "./ChatSessionProvider";
import type { ChatVariant } from "./variant";

/**
 * The chat view. All session state lives in ChatSessionProvider (mounted in
 * the root layout) so the sidebar's "New chat" button can reach it and so the
 * transcript survives navigating away and back.
 *
 * Two vertical layouts, one tree. An empty chat centers the greeting and the
 * composer together as a group in the middle of the page; once there is a
 * transcript the list takes the free space and scrolls, which pins the composer
 * to the bottom edge as a consequence rather than as a rule.
 *
 * Both are a class swap — `justify-center` here, `flex-1` vs `shrink-0` in
 * MessageList — never two branches of JSX. MessageInput holds the draft, the
 * caret, the slash-menu state and the textarea's measured height in local
 * state, so moving it between two trees would remount it and lose all of that
 * on the first message of every conversation.
 *
 * `variant` picks the surface. "page" is the route at `/` and keeps every class
 * it has always had. "rail" is the project IDE's side panel: it skips the
 * centering above, because a composer floating in the middle of a 26rem column
 * reads as broken rather than as an invitation, and it runs a size smaller
 * throughout.
 */
export default function ChatWindow({
  variant = "page",
}: {
  variant?: ChatVariant;
}) {
  const { sessionId, items, streaming, pending, send, stop } = useChatSession();
  const { preset } = useChatPreset();
  const rail = variant === "rail";

  return (
    <div
      className={cn(
        "flex w-full min-h-0 flex-col font-sans",
        rail
          ? // flex-1 rather than h-full: in the rail this sits below a header
            // strip, and h-full would add the header's height to the parent
            // and overflow it.
            "min-w-0 flex-1"
          : "mx-auto h-full max-w-4xl",
        // Only meaningful while MessageList is content-sized; with a transcript
        // it is flex-1 and there is no free space left to distribute.
        !rail && items.length === 0 && "justify-center",
      )}
    >
      <MessageList items={items} streaming={streaming} variant={variant} />

      <MessageInput
        disabled={streaming || !sessionId}
        pending={pending}
        onSubmit={(text) => void send(text, preset)}
        onStop={stop}
        variant={variant}
      />
    </div>
  );
}
