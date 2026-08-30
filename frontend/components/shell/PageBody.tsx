import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * The standard scroll container for a routed page inside the app shell.
 *
 * `min-h-0` is load-bearing: without it a flex child refuses to shrink below
 * its content height, so the scroll never happens and the whole shell grows a
 * second scrollbar instead.
 *
 * `width` defaults to the prose column every editor and the chat still want.
 * The card grids opt into `wide`, which is the only reason the prop exists —
 * three columns inside max-w-3xl are unreadable. The max-width is applied to
 * the toolbar row and the content div, not to this component's own root or to
 * the ScrollArea: those stay full-width so the scrollbar tracks the true edge
 * of the main page area instead of sitting at the edge of the centered column,
 * which left a dead strip of blank space beside it on any viewport wider than
 * the column.
 */
const WIDTHS = {
  prose: "max-w-3xl",
  wide: "max-w-6xl",
} as const;

export default function PageBody({
  children,
  toolbar,
  width = "prose",
}: {
  children: React.ReactNode;
  toolbar?: React.ReactNode;
  width?: keyof typeof WIDTHS;
}) {
  return (
    <div className="flex h-full w-full flex-col font-sans">
      {toolbar && (
        <div
          className={cn(
            "mx-auto flex w-full shrink-0 items-center justify-end gap-2 px-4 pt-4",
            WIDTHS[width],
          )}
        >
          {toolbar}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn("mx-auto w-full p-4", WIDTHS[width])}>{children}</div>
      </ScrollArea>
    </div>
  );
}
