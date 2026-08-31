"use client";

import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import type { EnvVarListRow } from "@/lib/env-var-types";

/**
 * Edit / Copy / Delete for one environment variable.
 *
 * One menu shared by the card and the table row, for the reason
 * ProjectActionsMenu gives.
 *
 * Copy offers the KEY, never the value — the value of a secret is not in this
 * component to copy (the server never sent it), and offering it for the
 * non-secret half only would be a menu whose items move around.
 */
export default function EnvVarActionsMenu({
  envVar,
  onEdit,
  onDelete,
}: {
  envVar: EnvVarListRow;
  onEdit: (envVar: EnvVarListRow) => void;
  onDelete: (envVar: EnvVarListRow) => void;
}) {
  async function copyKey() {
    if (await copyText(envVar.key)) {
      toast.success(`Copied ${envVar.key}`);
    } else {
      toast.error({
        title: "Could not copy",
        description: "The clipboard is only available over HTTPS or on localhost.",
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
          <MoreHorizontal />
          <span className="sr-only">Actions for {envVar.key}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => onEdit(envVar)}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyKey()}>
          <Copy />
          Copy name
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(envVar)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
