"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Takes a registry record straight into the composer.
 *
 * Addressed by slug (or, for MCP, by name) rather than id: both are unique
 * columns, and the resulting URL is legible and pasteable.
 */
export default function UseInChatButton({
  kind,
  value,
}: {
  kind: "agent" | "skill" | "mcp";
  value: string;
}) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={`/?${kind}=${encodeURIComponent(value)}`}>
        <MessageSquare />
        Use in chat
      </Link>
    </Button>
  );
}
