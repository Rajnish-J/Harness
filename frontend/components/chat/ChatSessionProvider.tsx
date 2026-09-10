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

import { fetchChatTranscript, resetSession, streamApproval, streamChat } from "@/lib/api";
import type { ChatPreset } from "@/lib/chat-preset";
import {
  getServerSessionIdSnapshot,
  getSessionIdSnapshot,
  rotateSessionId,
  setSessionId as setStoredSessionId,
  subscribeSessionId,
  type SessionScope,
} from "@/lib/session";
import { toTranscript } from "@/lib/transcript";
import type { AgentEvent, TranscriptItem } from "@/lib/types";

let counter = 0;
const nextId = () => `item-${++counter}`;

export type ApprovalDecision = { id: string; approved: boolean };

type ChatSessionValue = {
  sessionId: string | null;
  /** The project this chat belongs to, or undefined in the global chat on `/`. */
  projectId?: string;
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
  /** Start a fresh conversation. Returns the new id, so a caller that has to
   *  navigate to it does not have to read the store back out. */
  newChat: () => string;
  /** Reopen a past conversation. False when it had no messages to load. */
  openSession: (sessionId: string) => Promise<boolean>;
  /**
   * Point this provider at `id` because the URL says so.
   *
   * Idempotent, and a no-op when `id` is already open -- unlike openSession,
   * which always refetches and always overwrites `items`, so a soft
   * navigation back to the same chat would stomp a live transcript.
   */
  adoptSession: (id: string) => void;
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
 *
 * A project page mounts a SECOND instance of this provider, nested inside the
 * root one, with its own `scope`. React resolves context to the nearest
 * provider, so ChatWindow, MessageList, MessageInput and ApprovalCard bind to
 * whichever session encloses them without knowing either exists — and the chat
 * on `/` is left completely untouched.
 */
export default function ChatSessionProvider({
  children,
  scope = null,
  projectId,
  initialItems,
  initialSessionId,
}: {
  children: React.ReactNode;
  /** null is the global chat. A project passes its own scope. */
  scope?: SessionScope;
  /** Sent with every turn so the backend persists to the right project. */
  projectId?: string;
  /** Server-loaded history, so a returning project repaints what it had. */
  initialItems?: TranscriptItem[];
  /**
   * Which session `initialItems` belongs to, when the server was told.
   *
   * A deep link (`?chat=<id>`) makes the server load THAT session's history
   * rather than the newest one, and the store still holds whatever this
   * browser last had open -- a different id. Claiming `hydratedFor` for the
   * id the items actually came from is what stops `adoptSession` throwing
   * them away and refetching the same rows over HTTP.
   */
  initialSessionId?: string | null;
}) {
  // Curried so useSyncExternalStore gets stable callbacks: a new function
  // identity every render would resubscribe on every render.
  const subscribe = useCallback(
    (listener: () => void) => subscribeSessionId(scope, listener),
    [scope],
  );
  const snapshot = useCallback(() => getSessionIdSnapshot(scope), [scope]);

  const sessionId = useSyncExternalStore(
    subscribe,
    snapshot,
    getServerSessionIdSnapshot,
  );

  const [items, setItems] = useState<TranscriptItem[]>(initialItems ?? []);
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // The message currently in flight. An mcp_consent event parks the turn before
  // anything runs, and approving it means sending this same text again — but
  // applyEvent only sees the event, so the text is stashed here rather than
  // threaded through every case of that switch.
  const inFlightMessage = useRef<string>("");

  // Which session id the transcript has already been loaded for.
  //
  // A ref rather than state: this must run once per id, survive StrictMode's
  // double invocation, and never itself cause a render. Every path that fills
  // `items` on its own claims the id here, so the hydrate effect below reads
  // it as handled and does not fetch over the top of the result.
  const hydratedFor = useRef<string | null>(null);

  // A project scope is server-rendered with its history already in state, so
  // there is nothing to fetch. Claimed during render rather than in an effect
  // so the effect's very first run already sees it -- an effect would leave a
  // window in which the fetch had started.
  if (initialItems && initialItems.length > 0 && hydratedFor.current === null) {
    // `initialSessionId` when the server was told which conversation to load,
    // otherwise the store's id -- which is what the server fell back to.
    hydratedFor.current = initialSessionId ?? sessionId;
  }

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

        case "attach_proposal":
          return [
            ...prev,
            {
              kind: "attach_proposal",
              id: event.id,
              projectId: event.project_id,
              projectName: event.project_name,
              reason: event.reason ?? "",
            },
          ];

        case "project_proposal":
          return [
            ...prev,
            {
              kind: "project_proposal",
              id: event.id,
              name: event.name,
              description: event.description,
              template: event.template ?? "",
            },
          ];

        case "mcp_consent":
          return [
            ...prev,
            {
              kind: "mcp_consent",
              id: event.id,
              servers: event.servers ?? [],
              reason: event.reason ?? "",
              missing: event.missing ?? false,
              // Captured here because approving re-sends the turn rather than
              // resuming it — the backend parked before writing any history.
              message: inFlightMessage.current,
            },
          ];

        case "tool_selection":
          return [
            ...prev,
            {
              kind: "tool_selection",
              id: event.id,
              selected: event.selected,
              poolSize: event.pool_size,
              reason: event.reason ?? "",
              // Optional on the wire so an older harness that does not send
              // them still renders; absent reads as "it did not run".
              ran: event.ran ?? false,
              note: event.note ?? null,
              model: event.model ?? null,
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
          // automatic run. A resolved project_proposal deliberately falls
          // through to `return item` unchanged instead: ProjectProposalCard
          // already carries its own outcome UI (set optimistically in
          // resolveApprovals) and should not collapse into a generic step.
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
      inFlightMessage.current = text;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          {
            sessionId,
            message: text,
            preset,
            projectId,
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
    [sessionId, projectId, applyEvent],
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
          (item.kind === "approval" ||
            item.kind === "project_proposal" ||
            item.kind === "attach_proposal") &&
          verdicts.has(item.id)
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
          { sessionId, decisions, preset, projectId, signal: controller.signal },
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
    [sessionId, projectId, applyEvent],
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
    // Claim the new id so the hydrate effect treats it as handled. A fresh id
    // has no rows server-side, so its empty-result guard would already save us
    // -- claiming just avoids the pointless round trip on every "New chat".
    const created = rotateSessionId(scope);
    hydratedFor.current = created;
    setItems([]);
    setPending(false);
    // Fire-and-forget: the UI clears immediately, and a stale server session is
    // harmless once we have rotated away from its id. resetSession swallows
    // its own errors.
    if (sessionId) void resetSession(sessionId);
    // Returned so the caller can navigate to the new chat's URL without
    // reading the store back out and racing this rotation.
    return created;
  }, [sessionId, scope]);

  const openSession = useCallback(
    async (targetSessionId: string) => {
      abortRef.current?.abort();
      setPending(false);
      // Claim it up front: this function IS a load path, and letting the
      // hydrate effect fire on the same id would fetch the same transcript a
      // second time once the store update lands.
      hydratedFor.current = targetSessionId;
      // The store update (below) and this fetch race by design: the id is
      // adopted regardless of whether the transcript fetch succeeds, same as
      // `newChat` clearing the transcript before its fire-and-forget reset
      // lands. An empty repaint on a failed fetch beats being stuck on the
      // conversation the operator just clicked away from.
      const messages = await fetchChatTranscript(targetSessionId);
      setItems(toTranscript(messages));
      setStoredSessionId(scope, targetSessionId);
      // Reported rather than swallowed: fetchChatTranscript degrades to [] on
      // any failure, so a caller handed an id that does not exist would
      // otherwise adopt an empty conversation believing it worked. The deep
      // link uses this to decide whether to clean the URL.
      return messages.length > 0;
    },
    [scope],
  );

  /**
   * Adopt the session the URL names.
   *
   * This is the route's way in, and it deliberately does NOT load anything
   * itself: it clears the transcript and points the store at `id`, and the
   * hydrate effect below -- the one load path -- does the fetching. Two
   * functions racing to fill `items` is exactly the bug `hydratedFor` exists
   * to prevent, so this adds a caller to that effect rather than a rival.
   */
  const adoptSession = useCallback(
    (id: string) => {
      // Reads the STORE, not the `sessionId` render value: the store is
      // updated synchronously by setStoredSessionId below, so this guard is
      // correct even for a second call inside the same commit (Strict Mode
      // double-invokes the effect that calls this). It also keeps `sessionId`
      // out of the deps, so this callback stays stable across a session swap
      // and the caller's effect fires once per id rather than twice.
      if (!id || getSessionIdSnapshot(scope) === id) return;

      abortRef.current?.abort();
      setPending(false);
      // Already loaded for this id -- server-seeded `initialItems` claimed it
      // during render -- so those rows ARE this conversation and must survive.
      // Otherwise clear, which is load-bearing in the other direction: the
      // hydrate effect refuses to paint over a non-empty transcript
      // (`prev.length > 0 ? prev : ...`), so leaving the old chat's messages
      // in place would make its fetch a no-op and strand the wrong transcript.
      if (hydratedFor.current !== id) setItems([]);
      setStoredSessionId(scope, id);
      // No hydratedFor claim: leaving the new id unclaimed is precisely what
      // hands the load to the hydrate effect.
    },
    [scope],
  );

  /**
   * Repaint a conversation that is already in the database.
   *
   * The global chat on `/` mounts with no `initialItems`: its session id lives
   * in localStorage, which a server render cannot read, so there is nothing to
   * seed from. The rows ARE persisted, and the backend rehydrates the model's
   * own history from them -- so without this the agent goes on remembering the
   * conversation while the user stares at a blank screen.
   */
  useEffect(() => {
    if (!sessionId) return; // server snapshot, no id yet
    if (hydratedFor.current === sessionId) return; // loaded, or claimed
    if (streaming || pending) return; // never repaint over a live turn
    hydratedFor.current = sessionId; // claim BEFORE awaiting

    let cancelled = false;
    void fetchChatTranscript(sessionId).then((messages) => {
      // An empty answer is never painted: a freshly rotated id has no rows, a
      // failed fetch degrades to [], and mock mode always returns [] -- all
      // three would blank a transcript that is already correct.
      if (cancelled || messages.length === 0) return;
      setItems((prev) => (prev.length > 0 ? prev : toTranscript(messages)));
    });

    return () => {
      cancelled = true;
    };
    // streaming/pending are deps so a page that loaded mid-turn hydrates once
    // the turn settles; by then `items` is non-empty and the guard above makes
    // it a no-op.
  }, [sessionId, streaming, pending]);

  const value = useMemo(
    () => ({
      sessionId,
      // Exposed so consumers can tell which scope they are in: the summary
      // card only offers itself in the global chat, and the IDE's switcher
      // only lists the open project's conversations.
      projectId,
      items,
      streaming,
      pending,
      send,
      resolveApprovals,
      stop,
      newChat,
      openSession,
      adoptSession,
    }),
    [
      sessionId,
      projectId,
      items,
      streaming,
      pending,
      send,
      resolveApprovals,
      stop,
      newChat,
      openSession,
      adoptSession,
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
