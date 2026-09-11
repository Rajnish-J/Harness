"use client";

import { File as FileIcon, FileLock2 } from "lucide-react";
import { useEffect, useState } from "react";

import { File, Folder, Tree } from "@/components/ui/file-tree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { projectFilesApi } from "@/lib/project-api";
import type { TreeLevel } from "@/lib/project-types";

type Levels = Record<string, TreeLevel>;

/**
 * Fetch the root level, never rejecting.
 *
 * Returning the whole initial record means the effect can pass `setLevels`
 * directly rather than assigning inside it — calling setState in an effect body
 * is a lint error in this repo. Expansions happen in click handlers, where a
 * functional update is fine.
 */
async function loadRoot(projectId: string): Promise<Levels> {
  try {
    return { "": await projectFilesApi.tree(projectId, "") };
  } catch {
    return {};
  }
}

/**
 * The repository, one level at a time.
 *
 * Levels are fetched on expand rather than all at once: the index makes a
 * single level cheap, and a 5,000-file repo would otherwise send everything to
 * render a dozen visible rows. Once fetched a level is kept, so collapsing and
 * re-expanding costs nothing — components/ui/file-tree.tsx force-mounts its
 * content so a collapse does not throw the rendered rows away either.
 *
 * Binary files are shown but not selectable — hiding them would make the tree
 * disagree with the repository, and the editor cannot open them anyway.
 */
export default function FileTree({
  projectId,
  selected,
  onSelect,
}: {
  projectId: string;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [levels, setLevels] = useState<Levels>({});
  // The root is always open, and is not a row anyone can collapse.
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    loadRoot(projectId).then(setLevels);
  }, [projectId]);

  async function expand(dirPath: string) {
    try {
      const level = await projectFilesApi.tree(projectId, dirPath);
      setLevels((prev) => ({ ...prev, [dirPath]: level }));
    } catch (err) {
      // The row itself keeps showing "loading…" rather than an inline alert —
      // the tree is a navigation aid, and one bad directory should not take it
      // over — but a toast still says something went wrong instead of leaving
      // it a silent dead end.
      toast.error({
        title: `Could not open ${dirPath || "the project root"}`,
        description: (err as Error).message,
      });
    }
  }

  /**
   * Radix hands back the whole open set, not the row that changed, so the
   * newly-opened directories are whatever is in `next` but not in `expanded`.
   * Only those are fetched, and only if this is their first open — a level
   * already in `levels` is served from the cache.
   */
  function handleExpandedChange(next: string[]) {
    for (const dirPath of next) {
      if (!expanded.includes(dirPath) && !levels[dirPath]) void expand(dirPath);
    }
    setExpanded(next);
  }

  function renderLevel(dirPath: string, depth: number): React.ReactNode {
    const level = levels[dirPath];
    if (!level) {
      // Indented to match the rows that will replace them, so expanding a
      // directory does not shift everything sideways when its contents land.
      return (
        <div
          className="flex flex-col gap-1 py-1 pr-2"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      );
    }

    return (
      <>
        {level.directories.map((dir) => (
          <Folder key={dir.path} value={dir.path} name={dir.name} depth={depth}>
            {renderLevel(dir.path, depth + 1)}
          </Folder>
        ))}

        {level.files.map((file) => (
          <File
            key={file.path}
            value={file.path}
            depth={depth}
            disabled={file.is_binary}
            title={file.is_binary ? "Binary file — cannot be opened here" : file.path}
            icon={
              file.is_binary ? (
                <FileLock2 className="size-3.5 shrink-0 opacity-70" aria-hidden />
              ) : (
                <FileIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
              )
            }
          >
            {file.name}
          </File>
        ))}
      </>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1 pr-1">
        <Tree
          expanded={expanded}
          onExpandedChange={handleExpandedChange}
          selectedId={selected}
          onSelect={onSelect}
          aria-label="Project files"
        >
          {renderLevel("", 0)}
        </Tree>
      </div>
    </ScrollArea>
  );
}
