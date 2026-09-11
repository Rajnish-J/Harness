import { Skeleton } from "@/components/ui/skeleton";

/**
 * What `/` paints while it works out which chat to redirect to.
 *
 * Deliberately not <ChatWindow />: rendering the real thing would paint a live
 * composer and an empty greeting for a frame or two, and then swap it for the
 * conversation the redirect landed on. A chat-shaped skeleton reads as loading
 * rather than as an empty chat that flickered away.
 *
 * The frame mirrors ChatWindow's empty state -- same `justify-center` grouping
 * of greeting and composer, same max-w-4xl content column -- so the redirect
 * does not visibly move anything. Note the cap sits on the two children rather
 * than on the root, matching how ChatWindow now does it: the root is full
 * width there so the transcript's scrollbar can reach the window edge.
 */
export default function ChatWindowSkeleton() {
  return (
    <div className="flex h-full w-full flex-col justify-center font-sans">
      {/* Stands in for the greeting MessageList shows on an empty chat. */}
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-3 pb-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      {/* The composer. Its height is the textarea's resting height plus the
          toolbar row beneath it. */}
      <div className="mx-auto w-full max-w-4xl px-4 pb-6">
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}
