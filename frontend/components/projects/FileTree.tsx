"use client";

import { ChevronDown, ChevronRight, File, FileLock2, Folder } from "lucide-react";
import { useEffect, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
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
 * re-expanding costs nothing.
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
  const [open, setOpen] = useState<Set<string>>(new Set([""]));

  useEffect(() => {
    loadRoot(projectId).then(setLevels);
  }, [projectId]);

  async function expand(dirPath: string) {
    try {
      const level = await projectFilesApi.tree(projectId, dirPath);
      setLevels((prev) => ({ ...prev, [dirPath]: level }));
    } catch {
      // A level that will not load renders as "loading…" rather than an alert.
      // The tree is a navigation aid; one bad directory should not take it over.
    }
  }

  function toggle(dirPath: string) {
    const isOpen = open.has(dirPath);
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
    if (!isOpen && !levels[dirPath]) void expand(dirPath);
  }

  function renderLevel(dirPath: string, depth: number): React.ReactNode {
    const level = levels[dirPath];
    if (!level) {
      return (
        <p
          className="px-2 py-1 text-[11px] text-muted-foreground"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          loading…
        </p>
      );
    }

    return (
      <>
        {level.directories.map((dir) => {
          const expanded = open.has(dir.path);
          return (
            <div key={dir.path}>
              <button
                type="button"
                onClick={() => toggle(dir.path)}
                className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-xs hover:bg-accent"
                style={{ paddingLeft: depth * 12 + 8 }}
              >
                {expanded ? (
                  <ChevronDown className="size-3 shrink-0 opacity-60" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 opacity-60" />
                )}
                <Folder className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate">{dir.name}</span>
              </button>
              {expanded && renderLevel(dir.path, depth + 1)}
            </div>
          );
        })}

        {level.files.map((file) => (
          <button
            key={file.path}
            type="button"
            disabled={file.is_binary}
            onClick={() => onSelect(file.path)}
            title={file.is_binary ? "Binary file — cannot be opened here" : file.path}
            className={`flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-xs ${
              selected === file.path ? "bg-accent font-medium" : "hover:bg-accent"
            } ${file.is_binary ? "cursor-not-allowed opacity-40" : ""}`}
            style={{ paddingLeft: depth * 12 + 20 }}
          >
            {file.is_binary ? (
              <FileLock2 className="size-3.5 shrink-0 opacity-70" />
            ) : (
              <File className="size-3.5 shrink-0 opacity-70" />
            )}
            <span className="truncate">{file.name}</span>
          </button>
        ))}
      </>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1 pr-1">{renderLevel("", 0)}</div>
    </ScrollArea>
  );
}
