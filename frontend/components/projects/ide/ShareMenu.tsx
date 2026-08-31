"use client";

import {
  Database,
  ExternalLink,
  FileArchive,
  KeyRound,
  Link2,
  Share2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { API_BASE } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import type { WorkspaceShare } from "@/lib/ide-types";

/**
 * Share or export this workspace.
 *
 * Three of the five entries are real and two are not, and the menu does not
 * pretend otherwise: copying a link, the container password, and now the ZIP
 * export happen for real, while snapshots need an endpoint that does not
 * exist and says so when picked. The alternative — hiding the unbuilt one —
 * would make the menu look finished and leave no trace of what is still owed.
 */
async function copy(value: string, what: string): Promise<void> {
  if (await copyText(value)) {
    toast.success(`${what} copied.`);
    return;
  }
  toast.error({
    title: `Could not copy the ${what.toLowerCase()}`,
    description: "The clipboard is only available over HTTPS or on localhost.",
  });
}

function notWired(what: string, detail: string): void {
  toast.info({ title: `${what} is not wired up yet`, description: detail });
}

export default function ShareMenu({
  projectId,
  projectName,
  share,
  previewUrl,
}: {
  projectId: string;
  projectName: string;
  share: WorkspaceShare;
  previewUrl: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="h-7 gap-1.5 px-2.5">
          <Share2 className="size-3.5" />
          Share
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 p-1">
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-muted-foreground">
          Share or export this workspace
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2.5 py-2"
          onSelect={() => void copy(share.link, "Workspace link")}
        >
          <Link2 />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">Copy workspace link</span>
            <span className="text-[11px] text-muted-foreground">
              Share a direct link to this workspace
            </span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="gap-2.5 py-2"
          disabled={!previewUrl}
          onSelect={() => {
            if (previewUrl) window.open(previewUrl, "_blank", "noopener");
          }}
        >
          <ExternalLink />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">Open in new tab</span>
            <span className="text-[11px] text-muted-foreground">
              Launch the workspace in a separate browser tab
            </span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="gap-2.5 py-2"
          onSelect={() => {
            window.open(
              `${API_BASE}/api/projects/${projectId}/export.zip`,
              "_blank",
              "noopener",
            );
            toast.success(`Downloading ${projectName}.zip…`);
          }}
        >
          <FileArchive />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">Download as ZIP</span>
            <span className="text-[11px] text-muted-foreground">
              Export all workspace files as a .zip archive
            </span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="gap-2.5 py-2"
          onSelect={() =>
            notWired(
              "Save snapshot",
              "Versions are fixtures until something persists them.",
            )
          }
        >
          <Database />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">Save snapshot</span>
            <span className="text-[11px] text-muted-foreground">
              Persist the current files to the database
            </span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="gap-2.5 py-2"
          onSelect={() => void copy(share.password, "IDE password")}
        >
          <KeyRound />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">Copy IDE password</span>
            <span className="text-[11px] text-muted-foreground">
              The container access password
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
