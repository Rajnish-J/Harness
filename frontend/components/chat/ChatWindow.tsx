"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import { fetchConfig, resetSession, streamChat } from "@/lib/api";
import { getOrCreateSessionId, rotateSessionId } from "@/lib/session";
import type { AgentEvent, HarnessConfig, TranscriptItem } from "@/lib/types";

let counter = 0;
const nextId = () => `item-${++counter}`;

export default function ChatWindow() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // localStorage is only available in the browser, so the id is resolved
  // after mount rather than during render.
  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal).then(setConfig);
    return () => controller.abort();
  }, []);

  // Abort any in-flight stream if the component goes away. Paired with the
  // backend's is_disconnected() check, this actually halts the agent loop
  // instead of leaving it burning tokens for nobody.
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
    async (text: string) => {
      if (!sessionId) return;

      setItems((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          { sessionId, message: text, signal: controller.signal },
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

  const newChat = useCallback(async () => {
    abortRef.current?.abort();
    if (sessionId) await resetSession(sessionId);
    setSessionId(rotateSessionId());
    setItems([]);
  }, [sessionId]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col font-sans">
      <header className="flex items-center justify-between border-b border-black/[.08] px-4 py-3 dark:border-white/[.12]">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Harness</h1>
          <p className="font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
            {config
              ? `${config.provider} · ${config.model} · max ${config.max_iterations} iterations`
              : "connecting to harness core…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/workflows"
            className="rounded-lg border border-black/[.10] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.14] dark:hover:bg-white/[.06]"
          >
            Workflows
          </Link>
          <button
            type="button"
            onClick={newChat}
            className="rounded-lg border border-black/[.10] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.14] dark:hover:bg-white/[.06]"
          >
            New chat
          </button>
        </div>
      </header>

      <MessageList items={items} streaming={streaming} />

      <MessageInput
        disabled={streaming || !sessionId}
        onSubmit={send}
        onStop={stop}
      />
    </div>
  );
}
