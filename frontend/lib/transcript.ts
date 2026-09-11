import type { StoredMessage } from "./project-types";
import type { TranscriptItem } from "./types";

/**
 * Rebuild the visible transcript from what was persisted.
 *
 * The stored rows are the RENDERED transcript, not the provider's message list,
 * so this is a straight mapping rather than a reconstruction. Tool calls and
 * their results both carry the provider's call id, which is what lets
 * MessageList fold a result into the step its call created — exactly as it does
 * for a live stream.
 *
 * Shared by a project's own history (app/projects/[id]/vscode/page.tsx, loaded
 * server-side on mount) and reopening a past conversation from the sidebar's
 * history list (ChatSessionProvider.openSession, loaded client-side on click)
 * — both repaint the same shape of stored rows into the same transcript items.
 */
export function toTranscript(messages: StoredMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  // Tool calls seen since the last user message, so a finished turn can
  // report how much work it did. Reset per turn rather than accumulated:
  // the summary describes one turn, not the conversation.
  let steps = 0;

  for (const message of messages) {
    switch (message.role) {
      case "user":
        steps = 0;
        items.push({ kind: "user", id: `h-${message.seq}`, text: message.content ?? "" });
        break;
      case "assistant": {
        items.push({
          kind: "assistant",
          id: `h-${message.seq}`,
          text: message.content ?? "",
          messageUid: message.message_uid ?? undefined,
        });
        // Tokens on an assistant row mean this message ENDED a turn --
        // the backend stamps the totals onto the closing message only
        // (see _stamp_usage in backend/app/api/chat.py). A row without
        // them is mid-turn narration before a tool call, and correctly
        // gets no summary of its own.
        if (
          message.input_tokens !== null ||
          message.output_tokens !== null
        ) {
          items.push({
            kind: "turn_summary",
            id: `sum-${message.seq}`,
            steps,
            toolCalls: steps,
            inputTokens: message.input_tokens ?? 0,
            outputTokens: message.output_tokens ?? 0,
          });
          steps = 0;
        }
        break;
      }
      case "tool_call":
        // The router's decision is persisted as a tool_call named select_tools
        // rather than under a chat_role of its own — the enum lives in Drizzle
        // and adding a value would mean a migration for what is, on the wire,
        // exactly this: one call, with arguments, that shaped the turn. See
        // _entry_for in backend/app/api/chat.py.
        if (message.tool_name === "select_tools") {
          const args = (message.tool_args ?? {}) as {
            selected?: { name: string; group: string }[];
            pool_size?: number;
            reason?: string;
            ran?: boolean;
            note?: string | null;
            model?: string | null;
          };
          items.push({
            kind: "tool_selection",
            id: message.tool_call_id ?? `h-${message.seq}`,
            selected: args.selected ?? [],
            poolSize: args.pool_size ?? 0,
            reason: args.reason ?? "",
            ran: args.ran ?? false,
            note: args.note ?? null,
            model: args.model ?? null,
          });
          break;
        }
        steps += 1;
        items.push({
          kind: "step",
          id: message.tool_call_id ?? `h-${message.seq}`,
          name: message.tool_name ?? "tool",
          arguments: message.tool_args ?? {},
          status: "running",
        });
        break;
      case "tool_result": {
        // Fold into the step its call created, mirroring the live reducer.
        const id = message.tool_call_id ?? `h-${message.seq}`;
        const existing = items.findIndex((i) => i.id === id);
        const folded = {
          kind: "step" as const,
          id,
          name: message.tool_name ?? "tool",
          arguments:
            existing >= 0 && items[existing]!.kind === "step"
              ? (items[existing] as { arguments: Record<string, unknown> }).arguments
              : {},
          status: message.is_error ? ("error" as const) : ("ok" as const),
          result: message.content ?? "",
        };
        if (existing >= 0) items[existing] = folded;
        else items.push(folded);
        break;
      }
      case "error":
        items.push({
          kind: "error",
          id: `h-${message.seq}`,
          message: message.content ?? "",
          // The original code is not stored — the transcript keeps what was
          // shown, and every persisted error was already rendered as one.
          code: "persisted",
        });
        break;
    }
  }

  return items;
}
