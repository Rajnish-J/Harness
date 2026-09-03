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

export default function MessageBubble({ item }: { item: Bubble }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
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
          "rounded-lg border px-3 py-2 text-sm",
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

  return (
    <div className="max-w-[85%] whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
      {item.text}
    </div>
  );
}
