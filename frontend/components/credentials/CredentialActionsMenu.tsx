"use client";

import { MoreHorizontal, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Credential } from "@/lib/credential-types";

/**
 * Manage / Delete for one personal credential.
 *
 * One menu shared by the card and the table row, for the reason
 * ProjectActionsMenu gives: the two views are the same list seen two ways, and
 * an action available in one and missing from the other is a bug waiting to be
 * noticed.
 *
 * There is no inline Edit. A credential's only editable field that matters is
 * the token, and the editor exists to make replacing it deliberate — a dialog
 * that could swap a token from a list would be too easy to do by accident.
 */
export default function CredentialActionsMenu({
  credential,
  onDelete,
}: {
  credential: Credential;
  onDelete: (credential: Credential) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
          <MoreHorizontal />
          <span className="sr-only">Actions for {credential.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem asChild>
          <Link href={`/credentials/${credential.id}`}>
            <Settings2 />
            Manage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => onDelete(credential)}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
