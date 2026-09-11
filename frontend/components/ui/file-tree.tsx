"use client"

import * as React from "react"
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
} from "lucide-react"
import { Accordion as AccordionPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A tree of folders and files, built on Radix Accordion.
 *
 * Ported from the MagicUI `file-tree` registry component, with four changes
 * this repo requires -- see the notes on each below:
 *
 *   1. `radix-ui` namespace imports, not `@radix-ui/react-accordion`.
 *   2. Plain function components, not `forwardRef` (React 19).
 *   3. No `elements`/`sort` props -- this tree is fed lazily, one level at a
 *      time, and a materialised-array API would invite the opposite.
 *   4. Dense-row styling in place of Accordion's stock trigger, which is built
 *      for section headers rather than 20px file rows.
 *
 * WHY ACCORDION IS ALLOWED HERE, when components/chat/TranscriptDisclosure.tsx
 * explicitly rejected it: that rejection was of shadcn's *styled* Accordion --
 * `border-b` and `py-4 hover:underline` fighting a dense mono row -- and of a
 * single-value model for rows that toggle independently. Neither applies. This
 * file styles the Radix primitive directly rather than importing
 * components/ui/accordion.tsx, and a file tree genuinely wants `type="multiple"`
 * with several folders open at once. What Accordion buys, and what the tree it
 * replaced had none of, is real tree semantics: roving focus, arrow-key and
 * Home/End navigation, and `aria-expanded` on every folder.
 *
 * This is presentational only. It holds no fetching, knows nothing about
 * projects or the files API, and takes its rows as children.
 */

type TreeContextValue = {
  selectedId: string | null
  onSelect: (id: string) => void
  expanded: string[]
}

const TreeContext = React.createContext<TreeContextValue | null>(null)

function useTree() {
  const context = React.useContext(TreeContext)
  if (!context) {
    throw new Error("Folder and File must be rendered inside a Tree")
  }
  return context
}

/**
 * The tree root.
 *
 * Expansion is controlled by the caller rather than held here: the consumer
 * fetches a directory's contents when it opens, so it needs to know which
 * folders are open anyway. Keeping one copy of that state there avoids the two
 * drifting apart.
 */
function Tree({
  expanded,
  onExpandedChange,
  selectedId = null,
  onSelect,
  className,
  children,
  ...props
}: {
  /** Paths of every open folder. */
  expanded: string[]
  /** Called with the next open set. Fetch newly-opened folders from here. */
  onExpandedChange: (next: string[]) => void
  /** Path of the selected file, if any. */
  selectedId?: string | null
  onSelect: (path: string) => void
  // `onSelect` is also a DOM event on the underlying div, and the two would
  // intersect into a handler that can take neither type. Ours wins.
} & Omit<
  React.ComponentProps<typeof AccordionPrimitive.Root>,
  "type" | "value" | "onValueChange" | "defaultValue" | "onSelect"
>) {
  const context = React.useMemo(
    () => ({ selectedId, onSelect, expanded }),
    [selectedId, onSelect, expanded]
  )

  return (
    <TreeContext.Provider value={context}>
      <AccordionPrimitive.Root
        data-slot="tree"
        type="multiple"
        value={expanded}
        onValueChange={onExpandedChange}
        className={cn("flex flex-col", className)}
        {...props}
      >
        {children}
      </AccordionPrimitive.Root>
    </TreeContext.Provider>
  )
}

/**
 * One folder row, with its contents nested underneath.
 *
 * `depth` drives the indent rather than nested padding containers, so a row's
 * full width stays clickable however deep it sits.
 */
function Folder({
  value,
  name,
  depth = 0,
  className,
  children,
  ...props
}: {
  /** The directory path. Doubles as the Accordion item value. */
  value: string
  name: string
  depth?: number
} & Omit<React.ComponentProps<typeof AccordionPrimitive.Item>, "value">) {
  const { expanded } = useTree()
  const isOpen = expanded.includes(value)

  return (
    <AccordionPrimitive.Item
      data-slot="tree-folder"
      value={value}
      className={cn("border-none", className)}
      {...props}
    >
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger
          className="group/tree-folder flex w-full cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {/* Rotation keys off the Trigger's own data-state, which Radix
              stamps, rather than a second attribute driven from React state. */}
          <ChevronRight
            className="size-3 shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]/tree-folder:rotate-90"
            aria-hidden
          />
          {isOpen ? (
            <FolderOpenIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
          ) : (
            <FolderIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
          )}
          <span className="truncate">{name}</span>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>

      {/* A closed folder renders none of its rows. That is Radix's own
          behaviour and it is NOT worth fighting: CollapsibleContentImpl ends in
          `children: isOpen && children`, so even `forceMount` only keeps this
          wrapper div -- it does not bring the subtree back. Passing forceMount
          here would read as a cache optimisation while doing nothing at all.

          Re-expanding is cheap anyway, because the thing worth keeping is the
          FETCHED DATA, not the rendered rows. The consumer caches levels (see
          components/projects/FileTree.tsx) so reopening a folder re-renders
          from memory and issues no second request. */}
      <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        {children}
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  )
}

/**
 * One file row.
 *
 * A plain button rather than an Accordion part: files have nothing to expand,
 * and Accordion's roving focus already covers them as ordinary focusable
 * children of the tree.
 */
function File({
  value,
  depth = 0,
  icon,
  disabled = false,
  className,
  children,
  ...props
}: {
  /** The file path. */
  value: string
  depth?: number
  /** Defaults to a file glyph; pass one to mark binaries and the like. */
  icon?: React.ReactNode
} & Omit<React.ComponentProps<"button">, "value" | "onClick">) {
  const { selectedId, onSelect } = useTree()
  const isSelected = selectedId === value

  return (
    <button
      data-slot="tree-file"
      type="button"
      disabled={disabled}
      onClick={() => onSelect(value)}
      // +20 rather than +8: files line up with their siblings' NAMES, past the
      // chevron a folder row spends its first 12px on.
      style={{ paddingLeft: depth * 12 + 20 }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        isSelected ? "bg-accent font-medium" : "hover:bg-accent",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
        className
      )}
      {...props}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}

export { Tree, Folder, File }
