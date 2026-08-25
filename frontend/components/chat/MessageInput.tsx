"use client";

import { useRef, useState } from "react";

export default function MessageInput({
  disabled,
  onSubmit,
  onStop,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSubmit(text);
    setValue("");
    // Reset the auto-grown height along with the content.
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-black/[.08] px-4 py-3 dark:border-white/[.12]"
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={disabled ? "Agent is working…" : "Ask the agent to do something…"}
        onChange={(event) => {
          setValue(event.target.value);
          const el = event.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        }}
        onKeyDown={(event) => {
          // Enter sends; Shift+Enter inserts a newline.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        className="max-h-40 flex-1 resize-none rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-50 dark:border-white/[.14] dark:focus:border-zinc-500"
      />

      {disabled ? (
        <button
          type="button"
          onClick={onStop}
          className="h-9 shrink-0 rounded-lg border border-black/[.10] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.14] dark:hover:bg-white/[.06]"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!value.trim()}
          className="h-9 shrink-0 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-opacity disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Send
        </button>
      )}
    </form>
  );
}
