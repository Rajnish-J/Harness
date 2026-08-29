"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { ToolInfo } from "@/lib/workflow-api";

/**
 * The "Manage" surface for one tool group.
 *
 * Read-only on purpose: nothing in this stack turns a built-in tool off
 * globally — the per-agent `toolNames` list on /agents is where a tool is
 * included or left out. So this shows what the group contains and the exact
 * schema the model sees, and stops there rather than implying a toggle that
 * does not exist.
 */
export default function ToolGroupDialog({
  group,
  tools,
  open,
  onOpenChange,
}: {
  group: string;
  tools: ToolInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{group}</DialogTitle>
          <DialogDescription>
            {tools.length} {tools.length === 1 ? "tool" : "tools"} the agent can
            call. Included per agent from the Tools list on its preset.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <ul className="flex flex-col gap-2 pr-3">
            {tools.map((tool) => (
              <li key={tool.name} className="rounded-lg border px-3 py-2.5">
                <p className="font-mono text-sm font-medium">{tool.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tool.description}
                </p>
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
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
