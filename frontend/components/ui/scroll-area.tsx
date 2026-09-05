"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // The [&>div]: overrides are load-bearing, not cosmetic. Radix renders
        // its own element inside the viewport with `display:table;min-width:100%`
        // so that content wider than the box still stretches to fill it -- and a
        // table box grows to its widest child, which means nothing inside can be
        // told to shrink. A wide code block or markdown table then pushes the
        // whole column past its container, and the viewport grows a native
        // horizontal scrollbar across the top of the panel.
        //
        // block + min-w-0 + w-full restores the constraint in all three
        // directions, so children scroll inside their own overflow-x instead of
        // widening the column. These are !important because Radix sets the
        // originals as inline styles, which a class cannot otherwise beat.
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        // p-[3px] rather than p-px so the visible thumb is the same width as
        // the native ones styled in app/globals.css -- a page showing one of
        // each should not look like two applications.
        "flex touch-none p-[3px] transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        // Deliberately always visible, not opacity-0-until-hover: the chat
        // transcript is the one surface people actually scroll, and the bar's
        // position is the only cue for how far back the conversation goes.
        className="relative flex-1 rounded-full bg-border transition-colors hover:bg-muted-foreground"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
