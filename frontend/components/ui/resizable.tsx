"use client";

import { GripVertical } from "lucide-react";
import {
  Group as PanelGroupPrimitive,
  Panel as PanelPrimitive,
  Separator as SeparatorPrimitive,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

/**
 * Draggable split panes.
 *
 * A thin wrapper over react-resizable-panels, matching the naming the rest of
 * components/ui uses. Note this is v4, whose API is Group/Panel/Separator and
 * whose group takes `orientation` -- most shadcn snippets on the web target
 * v2's PanelGroup/PanelResizeHandle with `direction` and will not compile.
 *
 * Panel sizes are numbers in PIXELS (strings are percentages), which is what
 * lets a layout keep the exact widths it had before it became resizable.
 */

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof PanelGroupPrimitive>) {
  return (
    <PanelGroupPrimitive
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function ResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof PanelPrimitive>) {
  // min-w-0 so a panel's content can be told to shrink; without it flexbox's
  // min-width:auto lets a wide child set the panel's floor and the handle
  // stops short of where the user is dragging.
  return (
    <PanelPrimitive
      data-slot="resizable-panel"
      className={cn("min-h-0 min-w-0", className)}
      {...props}
    />
  );
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive> & {
  /** Show a visible grip. Worth it when the divider is easy to miss. */
  withHandle?: boolean;
}) {
  return (
    <SeparatorPrimitive
      data-slot="resizable-handle"
      className={cn(
        // A 1px line with a wider invisible hit area: a border-thin target is
        // miserable to grab, and padding the element itself would move the
        // panes apart.
        "relative flex w-px items-center justify-center bg-border",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        "data-[separator]:hover:bg-ring data-[separator]:active:bg-ring",
        "transition-colors",
        // Vertical groups turn the line and its hit area through 90 degrees.
        "[[data-orientation=vertical]_&]:h-px [[data-orientation=vertical]_&]:w-full",
        "[[data-orientation=vertical]_&]:after:left-0 [[data-orientation=vertical]_&]:after:h-2",
        "[[data-orientation=vertical]_&]:after:w-full [[data-orientation=vertical]_&]:after:translate-x-0",
        "[[data-orientation=vertical]_&]:after:-translate-y-1/2 [[data-orientation=vertical]_&]:after:top-1/2",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border">
          <GripVertical className="size-2.5" />
        </div>
      )}
    </SeparatorPrimitive>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
