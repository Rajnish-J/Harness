"use client";

import { ArrowUp, Bot, Sparkles, Square } from "lucide-react";
import { useRef, useState } from "react";

import AgentSwitcher from "./AgentSwitcher";
import AttachMenu from "./AttachMenu";
import AttachmentChips from "./AttachmentChips";
import { useChatPreset } from "./ChatPresetProvider";
import { Button } from "@/components/ui/button";
import {
  filterSlashOptions,
  replaceToken,
  slashTokenAt,
  type SlashOption,
} from "@/lib/slash";

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
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // The query is stored alongside the index so the highlight can be *derived*.
  // Resetting it in an effect would be a lint error and would also lag a
  // keystroke behind what the user sees.
  const [hl, setHl] = useState<{ query: string; index: number }>({
    query: "",
    index: 0,
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { catalog, setAgent, attachSkill } = useChatPreset();

  const token = slashTokenAt(value, caret);
  const slashOpen = token !== null && token.query !== dismissed;

  const options: SlashOption[] = slashOpen
    ? filterSlashOptions(
        [
          ...catalog.agents.map((agent) => ({
            kind: "agent" as const,
            id: agent.id,
            label: agent.name,
            hint: agent.description,
            terms: [agent.name, agent.slug],
          })),
          ...catalog.skills.map((skill) => ({
            kind: "skill" as const,
            id: skill.id,
            label: skill.name,
            hint: skill.description,
            terms: [skill.name, skill.slug],
          })),
        ],
        token.query,
      )
    : [];

  const highlight = hl.query === (token?.query ?? "") ? hl.index : 0;
  const active = options[Math.min(highlight, options.length - 1)];

  function sync(el: HTMLTextAreaElement) {
    setValue(el.value);
    setCaret(el.selectionStart ?? el.value.length);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function accept(option: SlashOption) {
    if (!token) return;
    // The mention becomes a chip, not text: the model should receive the skill
    // body, not the word the user typed to find it.
    const next = replaceToken(value, token, "");
    setValue(next.value);
    setCaret(next.caret);
    setDismissed(null);

    if (option.kind === "agent") {
      const agent = catalog.agents.find((a) => a.id === option.id);
      if (agent) void setAgent(agent);
    } else {
      const skill = catalog.skills.find((s) => s.id === option.id);
      if (skill) void attachSkill(skill);
    }

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSubmit(text);
    setValue("");
    setCaret(0);
    setDismissed(null);
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // The slash menu owns these keys while it is open, so Enter picks an option
    // instead of sending a half-typed message.
    if (slashOpen && options.length > 0 && token) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHl({ query: token.query, index: (highlight + 1) % options.length });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHl({
          query: token.query,
          index: (highlight - 1 + options.length) % options.length,
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (active) accept(active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Dismiss this query only, so typing another character reopens it.
        setDismissed(token.query);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <AgentSwitcher />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="relative rounded-2xl border bg-card shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-ring"
      >
        {slashOpen && options.length > 0 && (
          <ul
            role="listbox"
            aria-label="Attach a skill or agent"
            className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-md"
          >
            {options.map((option, index) => (
              <li
                key={`${option.kind}-${option.id}`}
                id={`slash-${option.kind}-${option.id}`}
                role="option"
                aria-selected={index === highlight}
                // onMouseDown, not onClick: click fires after blur, which would
                // move focus out of the textarea and close the menu first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  accept(option);
                }}
                onMouseEnter={() =>
                  setHl({ query: token?.query ?? "", index })
                }
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  index === highlight ? "bg-accent" : ""
                }`}
              >
                {option.kind === "agent" ? (
                  <Bot className="size-3.5 shrink-0 opacity-70" />
                ) : (
                  <Sparkles className="size-3.5 shrink-0 opacity-70" />
                )}
                <span className="truncate">{option.label}</span>
                {option.hint && (
                  <span className="ml-auto truncate text-[11px] text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <AttachmentChips />

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => sync(event.currentTarget)}
          onSelect={(event) =>
            setCaret(event.currentTarget.selectionStart ?? 0)
          }
          onKeyDown={onKeyDown}
          placeholder="Ask the harness anything.  /  to attach a skill or agent"
          aria-activedescendant={
            slashOpen && active ? `slash-${active.kind}-${active.id}` : undefined
          }
          className="max-h-[200px] w-full resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <AttachMenu />

          <span className="ml-auto hidden pr-1 text-[11px] text-muted-foreground sm:inline">
            ⏎ send · ⇧⏎ newline
          </span>

          {disabled ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="size-8 shrink-0"
              disabled={!value.trim()}
              aria-label="Send message"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
