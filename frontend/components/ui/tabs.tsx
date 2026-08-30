"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Layered sections of content, one panel at a time.
 *
 * Built on `radix-ui` like every other primitive in this folder, not on Base UI:
 * components.json pins this project to the new-york/Radix registry, and a second
 * headless library would mean two focus managers, two portal implementations and
 * two sets of data-attributes to style against for one component.
 *
 * Two looks, because the app needs both:
 *
 * - `default` — a filled track, for switching a form's sections.
 * - `line`    — an underline, for a page-level switch that sits directly above
 *               the content it filters. /credentials uses this one; it reads as
 *               part of the page rather than as a control floating on top of it.
 *
 * The variant travels by context rather than by prop-drilling onto every
 * trigger: a caller sets it once on the list, and the triggers cannot disagree
 * with the track they sit in.
 */

type TabsVariant = "default" | "line"

const TabsListVariantContext = React.createContext<TabsVariant>("default")

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn(
        "flex gap-2 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:flex-row",
        className
      )}
      {...props}
    />
  )
}

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: TabsVariant
}) {
  return (
    <TabsListVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          "inline-flex w-fit items-center",
          variant === "default" &&
            "rounded-lg bg-muted/60 p-0.5 text-muted-foreground data-[orientation=vertical]:flex-col",
          variant === "line" &&
            "gap-4 border-b border-border data-[orientation=vertical]:flex-col data-[orientation=vertical]:gap-0 data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:border-l",
          className
        )}
        {...props}
      />
    </TabsListVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsListVariantContext)

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === "default" &&
          "rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs",
        variant === "line" &&
          // -mb-px so the active underline sits on top of the list's border
          // rather than beside it.
          "-mb-px border-b-2 border-transparent px-0.5 pb-2.5 text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
