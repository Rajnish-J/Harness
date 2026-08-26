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

import { resetSession, streamApproval, streamChat } from "@/lib/api";
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

export type ApprovalDecision = { id: string; approved: boolean };

type ChatSessionValue = {
  sessionId: string | null;
  items: TranscriptItem[];
  streaming: boolean;
  /** Manual mode: a tool call is parked and the composer is waiting on a verdict. */
  pending: boolean;
  send: (text: string, preset?: ChatPreset) => Promise<void>;
  resolveApprovals: (
    decisions: ApprovalDecision[],
    preset?: ChatPreset,
  ) => Promise<void>;
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
  const [pending, setPending] = useState(false);
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

        case "approval_request":
          return [
            ...prev,
            {
              kind: "approval",
              id: event.id,
              name: event.name,
              arguments: event.arguments,
            },
          ];

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
          // tool round reads as a single line rather than two. An approved
          // call has no step yet — it has an approval card — so that becomes
          // the step here, and the transcript ends up identical to an
          // automatic run.
          return prev.map((item) => {
            if (item.id !== event.id) return item;

            if (item.kind === "step" || item.kind === "approval") {
              return {
                kind: "step",
                id: item.id,
                name: item.name,
                arguments: item.arguments,
                status: event.is_error ? "error" : "ok",
                result: event.content,
              };
            }
            return item;
          });

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
      setPending(false);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          {
            sessionId,
            message: text,
            preset,
            signal: controller.signal,
          },
          (event) => {
            // The turn is parked server-side, not finished — the composer has
            // to stay locked until the user rules on it.
            if (event.type === "done" && event.reason === "awaiting_approval") {
              setPending(true);
            }
            applyEvent(event);
          },
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

  /**
   * Finish a parked manual-mode turn.
   *
   * Sends the same preset the message was sent with, so the backend rebuilds
   * the same turn context: the toolset that was approved is the toolset that
   * runs.
   */
  const resolveApprovals = useCallback(
    async (decisions: ApprovalDecision[], preset?: ChatPreset) => {
      if (!sessionId) return;

      const verdicts = new Map(decisions.map((d) => [d.id, d.approved]));
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "approval" && verdicts.has(item.id)
            ? {
                ...item,
                decision: verdicts.get(item.id) ? "approved" : "denied",
              }
            : item,
        ),
      );

      setPending(false);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamApproval(
          { sessionId, decisions, preset, signal: controller.signal },
          (event) => {
            if (event.type === "done" && event.reason === "awaiting_approval") {
              setPending(true);
            }
            applyEvent(event);
          },
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

  const stop = useCallback(() => {
    abortRef.current?.abort();
    // A parked call the user walked away from is abandoned with the stream:
    // the next message starts a fresh turn, and the backend drops the pending
    // call the first time a resume is refused.
    setPending(false);
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    rotateSessionId();
    setItems([]);
    setPending(false);
    // Fire-and-forget: the UI clears immediately, and a stale server session is
    // harmless once we have rotated away from its id. resetSession swallows
    // its own errors.
    if (sessionId) void resetSession(sessionId);
  }, [sessionId]);

  const value = useMemo(
    () => ({
      sessionId,
      items,
      streaming,
      pending,
      send,
      resolveApprovals,
      stop,
      newChat,
    }),
    [
      sessionId,
      items,
      streaming,
      pending,
      send,
      resolveApprovals,
      stop,
      newChat,
    ],
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
