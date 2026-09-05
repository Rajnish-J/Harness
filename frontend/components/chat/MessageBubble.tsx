import Markdown from "@/components/chat/Markdown";
import type { ChatVariant } from "@/components/chat/variant";
import type { TranscriptItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Bubble = Extract<TranscriptItem, { kind: "user" | "assistant" | "error" }>;

/**
 * Codes that ride the `error` event but are not failures.
 *
 * The SSE contract has one channel for "something the user should read", so a
 * degraded-but-fine turn and a dead turn arrive identically. Rendering both in
 * alarm red trained the eye to ignore the colour: `mcp_unavailable` means the
 * turn ran without one server's tools, and `provider_switched` means the model
 * picker did exactly what was asked of it. Neither is a failure and neither
 * should look like one.
 */
const NOTICE_CODES = new Set(["mcp_unavailable", "provider_switched"]);

export default function MessageBubble({
  item,
  variant = "page",
}: {
  item: Bubble;
  variant?: ChatVariant;
}) {
  const compact = variant === "rail";

  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        {/* Plain text on purpose: a user typing *text* or pasting a shell
            snippet means the literal characters, and whitespace-pre-wrap keeps
            their line breaks. Only the assistant's side renders markdown. */}
        <div
          className={cn(
            "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary text-primary-foreground",
            compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm",
          )}
        >
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === "error") {
    const notice = NOTICE_CODES.has(item.code ?? "");
    return (
      <div
        className={cn(
          "rounded-lg border px-3 py-2",
          compact ? "text-xs" : "text-sm",
          notice
            ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
            : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
        )}
      >
        <span className="font-mono text-xs opacity-70">[{item.code}]</span>{" "}
        {item.message}
      </div>
    );
  }

  // Full width, not max-w-[85%]: an assistant message has no bubble background,
  // so the cap bought no visual grouping and only cramped code blocks and
  // tables. min-w-0 keeps a long code line from widening the flex parent.
  return (
    <div className="w-full min-w-0 break-words">
      <Markdown compact={compact}>{item.text}</Markdown>
    </div>
  );
}
