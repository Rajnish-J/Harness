"use client";

import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import { useChatPreset } from "./ChatPresetProvider";
import { useChatSession } from "./ChatSessionProvider";
import { cn } from "@/lib/utils";

/**
 * The chat view. All session state lives in ChatSessionProvider (mounted in
 * the root layout) so the sidebar's "New chat" button can reach it and so the
 * transcript survives navigating away and back.
 *
 * An empty transcript centres the greeting and the composer together; the first
 * message drops the composer to the bottom and lets the transcript fill above
 * it. That is a class swap on this one shared parent rather than two branches:
 * MessageInput holds the draft, the caret, the slash-menu state and the
 * textarea's measured height in local state, so moving it between two trees
 * would remount it and lose all of that mid-conversation.
 */
export default function ChatWindow() {
  const { sessionId, items, streaming, pending, send, stop } = useChatSession();
  const { preset } = useChatPreset();

  const empty = items.length === 0;

  return (
    <div
      className={cn(
        "mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col font-sans",
        empty && "justify-center",
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
