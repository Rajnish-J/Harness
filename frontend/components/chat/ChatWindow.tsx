"use client";

import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import { useChatPreset } from "./ChatPresetProvider";
import { useChatSession } from "./ChatSessionProvider";

/**
 * The chat view. All session state lives in ChatSessionProvider (mounted in
 * the root layout) so the sidebar's "New chat" button can reach it and so the
 * transcript survives navigating away and back.
 */
export default function ChatWindow() {
  const { sessionId, items, streaming, send, stop } = useChatSession();
  const { preset } = useChatPreset();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col font-sans">
      <MessageList items={items} streaming={streaming} />

      <MessageInput
        disabled={streaming || !sessionId}
        onSubmit={(text) => void send(text, preset)}
        onStop={stop}
      />
    </div>
  );
}
