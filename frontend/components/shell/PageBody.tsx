/**
 * The standard scroll container for a routed page inside the app shell.
 *
 * `min-h-0` is load-bearing: without it a flex child refuses to shrink below
 * its content height, so the scroll never happens and the whole shell grows a
 * second scrollbar instead.
 */
export default function PageBody({
  children,
  toolbar,
}: {
  children: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col font-sans">
      {toolbar && (
        <div className="flex shrink-0 items-center justify-end gap-2 px-4 pt-4">
          {toolbar}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}
