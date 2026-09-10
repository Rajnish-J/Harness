import { notFound } from "next/navigation";

import ProjectIde from "@/components/projects/ProjectIde";
import { API_BASE } from "@/lib/api";
import type { StoredMessage } from "@/lib/project-types";
import { toTranscript } from "@/lib/transcript";
import type { TranscriptItem } from "@/lib/types";
import { listCredentials } from "@/lib/server/credential-service";
import { getProject } from "@/lib/server/project-service";

export const dynamic = "force-dynamic";

/**
 * Never throws: a project must still open when its history cannot be read.
 *
 * `sessionId` is the conversation a deep link named. Passing it through is not
 * an optimisation: the provider claims any non-empty `initialItems` as already
 * loaded, so seeding it with the NEWEST session's transcript while the URL
 * asks for a different one would pin the wrong messages on screen and never
 * fetch the right ones.
 */
async function loadHistory(
  projectId: string,
  sessionId?: string,
): Promise<TranscriptItem[]> {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  try {
    const res = await fetch(
      `${API_BASE}/api/projects/${projectId}/chat/history${query}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { messages: StoredMessage[] };
    return toTranscript(body.messages ?? []);
  } catch {
    return [];
  }
}

// Next 16: params and searchParams both arrive as Promises.
export default async function ProjectIdePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?chat=<session_id>` deep-links one of this project's conversations. */
  searchParams: Promise<{ chat?: string }>;
}) {
  const [{ id }, { chat }] = await Promise.all([params, searchParams]);
  const project = await getProject(id);
  if (!project) notFound();

  const [initialMessages, credentials] = await Promise.all([
    loadHistory(id, chat),
    listCredentials(),
  ]);

  return (
    <ProjectIde
      project={project}
      initialMessages={initialMessages}
      initialSessionId={chat ?? null}
      credentials={credentials}
    />
  );
}
