import { notFound } from "next/navigation";

import ProjectIde from "@/components/projects/ProjectIde";
import { API_BASE } from "@/lib/api";
import type { StoredMessage } from "@/lib/project-types";
import { toTranscript } from "@/lib/transcript";
import type { TranscriptItem } from "@/lib/types";
import { listCredentials } from "@/lib/server/credential-service";
import { getProject } from "@/lib/server/project-service";

export const dynamic = "force-dynamic";

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
