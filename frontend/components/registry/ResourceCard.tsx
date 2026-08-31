import { Check, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The card every registry section renders — tools, MCP servers, skills, agents,
 * credentials, projects — and the one the chat's agent picker selects from.
 *
 * One component rather than six hand-rolled layouts: the sections sit next to
 * each other in the same shell, so a divergent card reads as a bug. `action` is
 * a slot instead of an `href` because /tools opens a dialog where the registry
 * pages navigate; omitting it entirely drops the footer, which is what lets the
 * picker wrap the whole card in a button without nesting interactive elements.
 *
 * `actions` is the second slot, and it exists for the same reason `action` does:
 * a project needs Edit and Delete on the card itself, and the alternative — a
 * ProjectCard that forks this file — would drift the moment either side was
 * touched. Pickers pass neither slot and stay safe to wrap in a button.
 */

/** Icon-tile tints. Keyed by role, not by page, so two pages showing the same
 *  kind of thing get the same colour. Each needs a `.dark` value — `dark:` is
 *  a class strategy here (see app/globals.css). */
export const CARD_TONES = {
  neutral: "bg-muted text-muted-foreground",
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  green: "bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400",
  purple: "bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
} as const;

export type CardTone = keyof typeof CARD_TONES;

/** Dot colours for `status`. Deliberately four, not one per clone_status —
 *  the card answers "can I use this yet", and the precise wording is the
 *  label's job. */
export const STATUS_TONES = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
  idle: "bg-muted-foreground/40",
} as const;

export type StatusTone = keyof typeof STATUS_TONES;

export type CardStatus = { tone: StatusTone; label: string };

export default function ResourceCard({
  icon: Icon,
  tone = "neutral",
  title,
  kind,
  meta,
  status,
  disabled = false,
  selected = false,
  action,
  actions,
}: {
  icon: LucideIcon;
  tone?: CardTone;
  title: string;
  /** The line under the title: a type label, a transport, a slug, a model. */
  kind?: string | null;
  /** The stat line above the rule. A node, not a string, so a caller can pass
   *  a row of chips — a branch, a file count — instead of one sentence. */
  meta?: React.ReactNode;
  /** A dot and a word for whether this is usable. Replaces the `disabled` pill
   *  where a caller knows something more specific than "off". */
  status?: CardStatus;
  disabled?: boolean;
  /** Currently chosen, in a picker. Purely presentational. */
  selected?: boolean;
  /** The full-width footer control. Omitted in pickers, where the card itself
   *  is the control. */
  action?: React.ReactNode;
  /** Top-right slot, for a row-actions menu. Omitted in pickers for the same
   *  reason as `action`. */
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-xl border bg-card text-card-foreground transition-all",
        "hover:border-foreground/15 hover:shadow-md",
        selected && "ring-2 ring-ring",
        disabled && "opacity-70",
      )}
    >
      {selected && (
        <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" aria-hidden />
        </span>
      )}

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-105",
              CARD_TONES[tone],
            )}
          >
            <Icon className="size-5" aria-hidden />
          </div>
          {actions && <div className="-mt-1 -mr-1 shrink-0">{actions}</div>}
        </div>

        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{title}</span>
            {/* Only when no richer `status` was given — the two say the same
                thing, and showing both reads as a contradiction. */}
            {disabled && !status && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                disabled
              </span>
            )}
          </p>
          {kind && (
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {kind}
            </p>
          )}
        </div>

        {status && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                STATUS_TONES[status.tone],
              )}
            />
            <span className="truncate">{status.label}</span>
          </p>
        )}

        {meta && (
          <div className="mt-auto text-xs text-muted-foreground">{meta}</div>
        )}
      </div>

      {action && <div className="border-t p-3">{action}</div>}
    </div>
  );
}
