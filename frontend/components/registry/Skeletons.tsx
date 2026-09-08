import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The placeholder shapes every loading state in the app is built from.
 *
 * One module rather than a skeleton hand-rolled per page: sixteen route
 * segments need a loading state, and sixteen slightly different guesses at what
 * a card looks like would drift from ResourceCard the first time it changed.
 * Each shape here mirrors a real component, so the placeholder occupies the
 * footprint the content will actually take and the swap is not a jolt.
 *
 * The rules these follow, taken from the two hand-written usages that predate
 * this file (ChatHistoryAccordion, ProjectChatSwitcher): the wrapper carries the
 * container's own spacing, heights match the real row, and nothing sets a
 * colour or radius — Skeleton supplies those.
 */

/** A run of list rows. `height` should equal the real row's height. */
export function SkeletonRows({
  count = 2,
  height = "h-6",
  className,
}: {
  count?: number;
  height?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn(height, "w-full")} />
      ))}
    </div>
  );
}

/**
 * One ResourceCard, mid-load. The measurements are copied from that component
 * rather than approximated: the size-11 icon tile and the bordered footer are
 * what give the card its height, so a placeholder without them collapses and
 * the grid jumps when the real cards arrive.
 */
export function SkeletonCard() {
  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex flex-1 flex-col gap-3 p-5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="mt-auto h-3 w-full" />
      </div>
      <div className="border-t p-3">
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}

/** The card grid shared by every registry page. */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <SkeletonCard />
        </li>
      ))}
    </ul>
  );
}

/** The rule-and-title above a grid, as rendered by SectionHeader. */
export function SkeletonSectionHeader() {
  return (
    <div className="flex items-center justify-between gap-3 pb-1">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-8 w-28" />
    </div>
  );
}

/**
 * A stack of labelled fields, for the editor pages.
 *
 * Deliberately not a faithful copy of any one editor — they differ in field
 * count and always will. It reproduces the rhythm (a short label over a taller
 * control, gap-5 between) so the page has the right weight while it loads.
 */
export function SkeletonFields({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * A whole editor page, mid-load: the EditorShell chrome plus a field stack.
 *
 * The header strip reproduces EditorShell's own `border-b px-4 py-2.5` rather
 * than a plain row, because that border is the line the eye tracks — without it
 * the page visibly reflows when the real shell arrives. It also copies the
 * shell's full-width root with the max-width one level in, so the border runs
 * edge to edge in both states and the swap moves nothing.
 *
 * The field count is a parameter and not a faithful copy of any one editor:
 * they differ in length and always will. What matters is the rhythm — a short
 * label over a taller control — so the page carries the right weight.
 *
 * `width` has to track whatever the real editor passes to EditorShell, or the
 * column jumps sideways the moment the swap happens.
 */
export function SkeletonEditor({
  fields = 5,
  width = "prose",
}: {
  fields?: number;
  width?: "prose" | "wide";
}) {
  const clamp = width === "wide" ? "max-w-6xl" : "max-w-3xl";

  return (
    <div className="flex h-full w-full flex-col font-sans">
      <div className="shrink-0 border-b px-4 py-2.5">
        <div className={cn("mx-auto flex w-full items-center gap-3", clamp)}>
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-4 w-40" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className={cn("mx-auto w-full p-4", clamp)}>
          <SkeletonFields count={fields} />
        </div>
      </div>
    </div>
  );
}
