"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
 *
 * A drawer rather than a centred modal: a group can hold forty tools, and this
 * is a list to work down while the grid behind it stays where it was. The
 * modal put a long scrolling list in the middle of the screen and covered the
 * page it came from. Floating — inset from all four edges — so it reads as
 * lifted above the grid rather than as a new screen.
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" floating className="gap-0 p-0">
        {/* pr-12 keeps the description clear of the close button, which the
            primitive pins at top-4 right-4. */}
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <SheetTitle>{group}</SheetTitle>
          <SheetDescription>
            {tools.length} {tools.length === 1 ? "tool" : "tools"} the agent can
            call. Switching one off here removes it from every chat and agent
            turn.
            {off > 0 && ` ${off} currently off.`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          {/* The same rail the composer's expanded groups draw, for the same
              reason: these are the members of one group, and a column of
              bordered cards says nothing about where the group ends. */}
          <ul className="relative ml-8 flex flex-col gap-1 py-4 pr-5 pl-6 before:absolute before:top-7 before:bottom-7 before:left-0 before:w-px before:bg-border before:content-['']">
            {tools.map((tool) => {
              const isOff = disabled.has(tool.name);
              return (
                <li
                  key={tool.name}
                  className={cn(
                    "relative rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/40",
                    isOff && "opacity-70",
                  )}
                >
                  <StepNode on={!isOff} />

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
      </SheetContent>
    </Sheet>
  );
}

/**
 * One node on the group's rail. The twin of the composer's, sized for this
 * denser row — see components/chat/CommandMenu.tsx.
 *
 * Pinned to the first line of the row rather than centred: these rows vary in
 * height with their description, and a node floating beside the middle of a
 * three-line block stops lining up with anything.
 */
function StepNode({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-[1.35rem] -left-6 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
    >
      <span
        className={cn(
          "absolute size-4 rounded-full transition-all duration-200",
          on ? "scale-100 bg-primary/20" : "scale-50 bg-transparent",
        )}
      />
      <span
        className={cn(
          "relative size-2 rounded-full ring-2 ring-background transition-colors duration-200",
          on ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}
