import { notFound } from "next/navigation";

import ProjectIde from "@/components/projects/ProjectIde";
import { API_BASE } from "@/lib/api";
import type { StoredMessage } from "@/lib/project-types";
import type { TranscriptItem } from "@/lib/types";
import { listCredentials } from "@/lib/server/credential-service";
import { getProject } from "@/lib/server/project-service";

export const dynamic = "force-dynamic";

/**
 * Rebuild the visible transcript from what was persisted.
 *
 * The stored rows are the RENDERED transcript, not the provider's message list,
 * so this is a straight mapping rather than a reconstruction. Tool calls and
 * their results both carry the provider's call id, which is what lets
 * MessageList fold a result into the step its call created — exactly as it does
 * for a live stream.
 */
function toTranscript(messages: StoredMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user":
        items.push({ kind: "user", id: `h-${message.seq}`, text: message.content ?? "" });
        break;
      case "assistant":
        items.push({
          kind: "assistant",
          id: `h-${message.seq}`,
          text: message.content ?? "",
        });
        break;
      case "tool_call":
        items.push({
          kind: "step",
          id: message.tool_call_id ?? `h-${message.seq}`,
          name: message.tool_name ?? "tool",
          arguments: message.tool_args ?? {},
          status: "running",
        });
        break;
      case "tool_result": {
        // Fold into the step its call created, mirroring the live reducer.
        const id = message.tool_call_id ?? `h-${message.seq}`;
        const existing = items.findIndex((i) => i.id === id);
        const folded = {
          kind: "step" as const,
          id,
          name: message.tool_name ?? "tool",
          arguments:
            existing >= 0 && items[existing]!.kind === "step"
              ? (items[existing] as { arguments: Record<string, unknown> }).arguments
              : {},
          status: message.is_error ? ("error" as const) : ("ok" as const),
          result: message.content ?? "",
        };
        if (existing >= 0) items[existing] = folded;
        else items.push(folded);
        break;
      }
      case "error":
        items.push({
          kind: "error",
          id: `h-${message.seq}`,
          message: message.content ?? "",
          // The original code is not stored — the transcript keeps what was
          // shown, and every persisted error was already rendered as one.
          code: "persisted",
        });
        break;
    }
  }

  return items;
}

/** Never throws: a project must still open when its history cannot be read. */
async function loadHistory(projectId: string): Promise<TranscriptItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/projects/${projectId}/chat/history`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { messages: StoredMessage[] };
    return toTranscript(body.messages ?? []);
  } catch {
    return [];
  }
}

// Next 16: params arrive as a Promise.
export default async function ProjectIdePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [initialMessages, credentials] = await Promise.all([
    loadHistory(id),
    listCredentials(),
  ]);

  return (
    <ProjectIde project={project} initialMessages={initialMessages} credentials={credentials} />
  );
}
