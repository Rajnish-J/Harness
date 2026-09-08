"use client";

import { BookOpen, Check, Plug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import CatalogWizard from "@/components/mcp/CatalogWizard";
import ResourceCard from "@/components/registry/ResourceCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MCP_CATALOG, type CatalogEntry } from "@/lib/mcp-catalog";

/**
 * Browse the known servers and add one without typing a connection.
 *
 * Sits next to "New server" rather than replacing it: the catalog is the easy
 * path for servers the harness already knows, and the blank editor remains the
 * way to reach everything else.
 *
 * `installed` is passed down from the page's server-rendered list so an entry
 * already added shows as configured and links to itself. Without it the card
 * would offer to add a duplicate, and `mcp_servers_name_uq` would reject it
 * with a 409 after the operator had already filled in the whole wizard.
 */
export default function CatalogButton({
  installed,
}: {
  /** Name → id, for the servers that already exist. */
  installed: Record<string, string>;
}) {
  const router = useRouter();
  const [browsing, setBrowsing] = useState(false);
  const [adding, setAdding] = useState<CatalogEntry | null>(null);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setBrowsing(true)}>
        <BookOpen className="size-4" />
        Browse catalog
      </Button>

      <Dialog open={browsing} onOpenChange={setBrowsing}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>MCP catalog</DialogTitle>
            <DialogDescription>
              Servers the harness knows how to connect. Adding one asks only for
              the credentials it needs.
            </DialogDescription>
          </DialogHeader>

          <ul className="grid gap-3 py-2 sm:grid-cols-2">
            {MCP_CATALOG.map((entry) => {
              const existingId = installed[entry.name];
              return (
                <li key={entry.id}>
                  <ResourceCard
                    icon={Plug}
                    tone="purple"
                    title={entry.title}
                    kind={entry.transport}
                    meta={entry.description}
                    status={
                      existingId
                        ? { tone: "ok", label: "Configured" }
                        : undefined
                    }
                    action={
                      existingId ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            setBrowsing(false);
                            router.push(`/mcp/${existingId}`);
                          }}
                        >
                          <Check className="size-4" />
                          Manage
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            setBrowsing(false);
                            setAdding(entry);
                          }}
                        >
                          Add
                        </Button>
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>

      {adding && (
        <CatalogWizard
          entry={adding}
          open
          onOpenChange={(next) => !next && setAdding(null)}
        />
      )}
    </>
  );
}
