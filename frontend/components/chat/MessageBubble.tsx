import type { TranscriptItem } from "@/lib/types";

type Bubble = Extract<TranscriptItem, { kind: "user" | "assistant" | "error" }>;

export default function MessageBubble({ item }: { item: Bubble }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2.5 text-sm text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
        <span className="font-mono text-xs opacity-70">[{item.code}]</span>{" "}
        {item.message}
      </div>
    );
  }

  return (
    <div className="max-w-[85%] whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
      {item.text}
    </div>
  );
}
