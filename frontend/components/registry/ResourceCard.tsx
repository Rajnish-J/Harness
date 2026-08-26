import { Check, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The card every registry section renders — tools, MCP servers, skills, agents
 * — and the one the chat's agent picker selects from.
 *
 * One component rather than five hand-rolled layouts: the sections sit next to
 * each other in the same shell, so a divergent card reads as a bug. `action` is
 * a slot instead of an `href` because /tools opens a dialog where the registry
 * pages navigate; omitting it entirely drops the footer, which is what lets the
 * picker wrap the whole card in a button without nesting interactive elements.
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

export default function ResourceCard({
  icon: Icon,
  tone = "neutral",
  title,
  kind,
  meta,
  disabled = false,
  selected = false,
  action,
}: {
  icon: LucideIcon;
  tone?: CardTone;
  title: string;
  /** The line under the title: a type label, a transport, a slug, a model. */
  kind?: string | null;
  /** The stat line above the rule: "3 tools", a description. */
  meta?: string | null;
  disabled?: boolean;
  /** Currently chosen, in a picker. Purely presentational. */
  selected?: boolean;
  /** The full-width footer control. Omitted in pickers, where the card itself
   *  is the control. */
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-xl border bg-card text-card-foreground",
        selected && "ring-2 ring-ring",
      )}
    >
      {selected && (
        <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" aria-hidden />
        </span>
      )}

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl",
            CARD_TONES[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>

        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{title}</span>
            {disabled && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                disabled
              </span>
            )}
          </p>
          {kind && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{kind}</p>
          )}
        </div>

        {meta && (
          <p className="mt-auto line-clamp-2 text-xs text-muted-foreground">{meta}</p>
        )}
      </div>

      {action && <div className="border-t p-3">{action}</div>}
    </div>
  );
}
