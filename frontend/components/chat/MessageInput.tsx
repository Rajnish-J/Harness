"use client";

import { ArrowUp, Bot, Plug, Sparkles, Square } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef, useState } from "react";

import AttachmentChips from "./AttachmentChips";
import CommandMenu from "./CommandMenu";
import { useChatPreset } from "./ChatPresetProvider";
import ModelPicker from "./ModelPicker";
import ModeSelector from "./ModeSelector";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  filterSlashOptions,
  replaceToken,
  slashTokenAt,
  type SlashOption,
} from "@/lib/slash";

/**
 * How tall the box may grow before it scrolls internally. Named because the
 * same number has to appear in the two auto-grow handlers and in the class —
 * as three loose literals they drift apart the first time one is tuned.
 */
const MAX_COMPOSER_PX = 320;

/** Same glyphs the "/" panel uses, so a typed match reads as the same thing. */
const SLASH_ICONS: Record<SlashOption["kind"], LucideIcon> = {
  agent: Bot,
  skill: Sparkles,
  mcp: Plug,
};

export default function MessageInput({
  disabled,
  pending,
  onSubmit,
  onStop,
}: {
  disabled: boolean;
  /** A manual-mode tool call is parked; the turn resumes on a verdict. */
  pending?: boolean;
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
  const { catalog, setAgent, attachSkill, toggleMcp } = useChatPreset();

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
          ...catalog.mcp.map((server) => ({
            kind: "mcp" as const,
            id: server.id,
            label: server.name,
            hint: server.description ?? server.transport,
            terms: [server.name],
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
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
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
    } else if (option.kind === "skill") {
      const skill = catalog.skills.find((s) => s.id === option.id);
      if (skill) void attachSkill(skill);
    } else {
      const server = catalog.mcp.find((s) => s.id === option.id);
      if (server) toggleMcp(server);
    }

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
    });
  }

  function submit() {
    const text = value.trim();
    if (!text || disabled || pending) return;
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="relative rounded-2xl border bg-card shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-ring"
      >
        {slashOpen && options.length > 0 && (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-full rounded-xl border bg-popover shadow-md">
            <ScrollArea className="max-h-64">
              <ul
                role="listbox"
                aria-label="Attach an agent, skill or MCP server"
                className="p-1"
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
                    {(() => {
                      const Icon = SLASH_ICONS[option.kind];
                      return <Icon className="size-3.5 shrink-0 opacity-70" />;
                    })()}
                    <span className="truncate">{option.label}</span>
                    {option.hint && (
                      <span className="ml-auto truncate text-[11px] text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
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
          disabled={pending}
          placeholder={
            pending
              ? "Approve or deny the pending tool call to continue…"
              : "Ask the harness anything.  /  for agents, skills, tools and MCP"
          }
          aria-activedescendant={
            slashOpen && active ? `slash-${active.kind}-${active.id}` : undefined
          }
          // min-h floors the inline height the handlers set, so auto-grow
          // still works and submit()'s reset lands on three lines, not one.
          className="max-h-[320px] min-h-[84px] w-full resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />

        {/*
          Only two controls ride in this row: the mode and the model. Everything
          that can be *attached* — agents, skills, tools, MCP servers — lives
          behind the "/" button, which is the same thing typing "/" opens.
        */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          <CommandMenu />
          <ModeSelector />
          <ModelPicker />

          <span className="ml-auto" />

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
              disabled={!value.trim() || pending}
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
