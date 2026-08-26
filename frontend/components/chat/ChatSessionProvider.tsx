"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { resetSession, streamChat } from "@/lib/api";
import type { ChatPreset } from "@/lib/chat-preset";
import {
  getServerSessionIdSnapshot,
  getSessionIdSnapshot,
  rotateSessionId,
  subscribeSessionId,
} from "@/lib/session";
import type { AgentEvent, TranscriptItem } from "@/lib/types";

let counter = 0;
const nextId = () => `item-${++counter}`;

type ChatSessionValue = {
  sessionId: string | null;
  items: TranscriptItem[];
  streaming: boolean;
  send: (text: string, preset?: ChatPreset) => Promise<void>;
  stop: () => void;
  newChat: () => void;
};

const ChatSessionContext = createContext<ChatSessionValue | null>(null);

/**
 * Owns the whole chat session: the transcript, the in-flight stream, and the
 * session id.
 *
 * This used to live inside ChatWindow, which meant the sidebar's "New chat"
 * button had no way to reach it. Holding it here — in the root layout, which
 * React does not remount on navigation — also means the transcript survives a
 * trip to /workflows and back, instead of being wiped by the unmount.
 */
export default function ChatSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionId = useSyncExternalStore(
    subscribeSessionId,
    getSessionIdSnapshot,
    getServerSessionIdSnapshot,
  );

  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream if the app goes away. Paired with the backend's
  // is_disconnected() check, this actually halts the agent loop instead of
  // leaving it burning tokens for nobody.
  useEffect(() => () => abortRef.current?.abort(), []);

  const applyEvent = useCallback((event: AgentEvent) => {
    setItems((prev) => {
      switch (event.type) {
        case "assistant_message":
          return [...prev, { kind: "assistant", id: nextId(), text: event.text }];

        case "tool_call":
          return [
            ...prev,
            {
              kind: "step",
              id: event.id,
              name: event.name,
              arguments: event.arguments,
              status: "running",
            },
          ];

        case "tool_result":
          // Fold the result into the step the call already created, so one
          // tool round reads as a single line rather than two.
          return prev.map((item) =>
            item.kind === "step" && item.id === event.id
              ? {
                  ...item,
                  status: event.is_error ? "error" : "ok",
                  result: event.content,
                }
              : item,
          );

        case "error":
          return [
            ...prev,
            {
              kind: "error",
              id: nextId(),
              message: event.message,
              code: event.code,
            },
          ];

        case "done":
          return prev;
      }
    });
  }, []);

  const send = useCallback(
    // The preset is an argument rather than a closure capture, so toggling a
    // chip does not invalidate this memo and re-render the whole transcript.
    async (text: string, preset?: ChatPreset) => {
      if (!sessionId) return;

      setItems((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          { sessionId, message: text, preset, signal: controller.signal },
          applyEvent,
        );
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              id: nextId(),
              code: "network",
              message:
                error instanceof Error
                  ? error.message
                  : "Could not reach the harness backend.",
            },
          ]);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, applyEvent],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    rotateSessionId();
    setItems([]);
    // Fire-and-forget: the UI clears immediately, and a stale server session is
    // harmless once we have rotated away from its id. resetSession swallows
    // its own errors.
    if (sessionId) void resetSession(sessionId);
  }, [sessionId]);

  const value = useMemo(
    () => ({ sessionId, items, streaming, send, stop, newChat }),
    [sessionId, items, streaming, send, stop, newChat],
  );

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSession(): ChatSessionValue {
  const value = useContext(ChatSessionContext);
  if (!value) {
    throw new Error("useChatSession must be used within a ChatSessionProvider.");
  }
  return value;
}
