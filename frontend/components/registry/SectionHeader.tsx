import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The titled rule above a card grid: "Built-in Tools ⓘ" on the left, the
 * section's own action (New MCP server, New skill…) on the right.
 */
export default function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  /** Shown behind an info icon rather than as a permanent sub-line. */
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pb-1">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        {title}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Info className="size-3.5" aria-label={hint} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        )}
      </h2>
      {action}
    </div>
  );
}
