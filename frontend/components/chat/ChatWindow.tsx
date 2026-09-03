"use client";

import { cn } from "@/lib/utils";

import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import { useChatPreset } from "./ChatPresetProvider";
import { useChatSession } from "./ChatSessionProvider";

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
 */
export default function ChatWindow() {
  const { sessionId, items, streaming, pending, send, stop } = useChatSession();
  const { preset } = useChatPreset();

  return (
    <div
      className={cn(
        "mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col font-sans",
        // Only meaningful while MessageList is content-sized; with a transcript
        // it is flex-1 and there is no free space left to distribute.
        items.length === 0 && "justify-center",
      )}
    >
      <MessageList items={items} streaming={streaming} />

      <MessageInput
        disabled={streaming || !sessionId}
        pending={pending}
        onSubmit={(text) => void send(text, preset)}
        onStop={stop}
      />
    </div>
  );
}
