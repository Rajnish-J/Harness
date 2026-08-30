"use client";

import { LayoutGrid, Rows3 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Grid ⇄ list, as two buttons rather than a Radix ToggleGroup.
 *
 * Same reasoning as SegmentedField in ./fields.tsx: the options are few and
 * always worth showing. Two buttons in a bordered track need no primitive, no
 * roving-focus manager and no new dependency — `aria-pressed` already says
 * everything a screen reader needs about which one is on.
 */
export type ViewMode = "grid" | "list";

export const VIEW_MODES = ["grid", "list"] as const;

const OPTIONS: { value: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { value: "grid", label: "Grid view", icon: LayoutGrid },
  { value: "list", label: "List view", icon: Rows3 },
];

export default function ViewSwitch({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "grid size-7 place-items-center rounded-md transition-colors outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <option.icon className="size-3.5" aria-hidden />
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
