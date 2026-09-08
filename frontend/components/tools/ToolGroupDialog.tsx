"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { DisabledTools } from "@/lib/tool-selection";
import { cn } from "@/lib/utils";
import type { ToolInfo } from "@/lib/workflow-api";

/**
 * The "Manage" surface for one tool group, and the place a tool is switched off
 * for good.
 *
 * This used to be read-only, on the grounds that nothing in the stack turned a
 * built-in tool off globally and a switch here would have implied a power that
 * did not exist. It exists now: a tool switched off here is written to
 * tool_settings, and `_prepare_turn` in backend/app/api/chat.py subtracts the
 * list from every turn's toolset after resolving it — so this is enforcement,
 * not a display filter. A composer that has not heard about the change yet
 * still cannot spend the tool.
 *
 * What it does NOT do is narrow one conversation. That is the composer's "/"
 * panel, and an agent's own preset. This is the floor under both.
 */
export default function ToolGroupDialog({
  group,
  tools,
  disabled,
  pending,
  onSetTool,
  open,
  onOpenChange,
}: {
  group: string;
  tools: ToolInfo[];
  /** Names switched off globally. */
  disabled: DisabledTools;
  /** Names with a write in flight — switches stay put until the server agrees. */
  pending: ReadonlySet<string>;
  onSetTool: (name: string, enabled: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const off = tools.filter((tool) => disabled.has(tool.name)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{group}</DialogTitle>
          <DialogDescription>
            {tools.length} {tools.length === 1 ? "tool" : "tools"} the agent can
            call. Switching one off here removes it from every chat and agent
            turn.
            {off > 0 && ` ${off} currently off.`}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <ul className="flex flex-col gap-2 pr-3">
            {tools.map((tool) => {
              const isOff = disabled.has(tool.name);
              return (
                <li
                  key={tool.name}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 transition-opacity",
                    isOff && "opacity-70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "font-mono text-sm font-medium",
                          isOff && "line-through",
                        )}
                      >
                        {tool.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {tool.description}
                      </p>
                      {isOff && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Off for every agent and every chat.
                        </p>
                      )}
                    </div>

                    <Switch
                      checked={!isOff}
                      disabled={pending.has(tool.name)}
                      onCheckedChange={(next) => onSetTool(tool.name, next)}
                      aria-label={`Toggle ${tool.name}`}
                      className="mt-0.5 shrink-0"
                    />
                  </div>

                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">
                      Input schema
                    </summary>
                    <ScrollArea className="mt-1.5 rounded-md bg-muted/50">
                      <pre className="p-2.5 font-mono text-[11px]">
                        {JSON.stringify(tool.input_schema, null, 2)}
                      </pre>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </details>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
