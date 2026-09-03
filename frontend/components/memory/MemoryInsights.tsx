"use client";

import { Brain, FolderGit2, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import MemoryFlowPanel from "@/components/memory/MemoryFlowPanel";
import MemoryGroupList, { type MemoryGroup } from "@/components/memory/MemoryGroupList";
import EmptyState from "@/components/registry/EmptyState";
import SectionHeader from "@/components/registry/SectionHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { flags } from "@/lib/flags";
import { memoryApi, type MemoryOverview, type MemoryPreview } from "@/lib/memory-api";
import { MOCK_MEMORY_PROJECTS } from "@/lib/mock/memory";
import { projectsApi } from "@/lib/project-api";

type ProjectLabel = { id: string; name: string };

/**
 * Read-only view of what the agent remembers and how it gets there.
 *
 * Fetched in the browser, like ToolsBrowser: this data comes from the Python
 * harness at API_BASE rather than Drizzle, so a server-side fetch would block
 * the page on Python being up.
 *
 * Three questions, three tabs — which project owns a memory, which
 * conversation produced it, and what the model literally receives. Every write
 * path stays on /memory; nothing here mutates anything.
 */
export default function MemoryInsights() {
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [preview, setPreview] = useState<MemoryPreview | null>(null);
  // Seeded rather than fetched under mock mode: `flags.mockMemory` is inlined
  // at build time, so this initial value is identical on the server render and
  // in the browser, and no effect has to write it.
  const [projects, setProjects] = useState<ProjectLabel[]>(
    flags.mockMemory ? MOCK_MEMORY_PROJECTS : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [previewScope, setPreviewScope] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    memoryApi
      .overview(controller.signal)
      .then((data) => {
        setOverview(data);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setOverview({ memories: [], sessions: [] });
        setError(err.message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    memoryApi
      .preview(previewScope, controller.signal)
      .then(setPreview)
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setPreview(null);
      });
    return () => controller.abort();
  }, [previewScope]);

  useEffect(() => {
    // projectsApi has no mock branch of its own — projects always hit Postgres
    // — so in mock mode the fixtures above supply the names instead. Without
    // that, groups would be labelled with raw uuids whenever Postgres is down.
    if (flags.mockMemory) return;
    projectsApi
      .list()
      .then((rows) => setProjects(rows.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, []);

  const memories = useMemo(() => overview?.memories ?? [], [overview]);

  const byProject = useMemo<MemoryGroup[]>(() => {
    const global = memories.filter((m) => m.project_id === null);
    const groups: MemoryGroup[] = [
      {
        id: "__global__",
        label: "Global",
        caption: "Reaches every project and the top-level chat",
        memories: global,
      },
    ];

    // Every known project gets a row, including ones with nothing remembered
    // yet — "this project has learned nothing" is worth seeing.
    for (const project of projects) {
      groups.push({
        id: project.id,
        label: project.name,
        caption: "Only this project's conversations",
        memories: memories.filter((m) => m.project_id === project.id),
      });
    }

    // A memory whose project is gone or unknown to this client still exists
    // and still reaches that project's chats, so it must not vanish here.
    const known = new Set(projects.map((p) => p.id));
    const orphaned = memories.filter(
      (m) => m.project_id !== null && !known.has(m.project_id),
    );
    if (orphaned.length > 0) {
      groups.push({
        id: "__unknown_project__",
        label: "Unknown project",
        caption: "The project row could not be loaded",
        memories: orphaned,
        muted: true,
      });
    }

    return groups;
  }, [memories, projects]);

  const bySession = useMemo<MemoryGroup[]>(() => {
    const sessions = overview?.sessions ?? [];
    const groups: MemoryGroup[] = [];

    for (const session of sessions) {
      groups.push({
        id: session.session_id,
        label: session.title,
        caption: `${session.message_count} messages · ${session.session_id}`,
        memories: memories.filter((m) => m.session_id === session.session_id),
      });
    }

    const resolved = new Set(sessions.map((s) => s.session_id));
    const dangling = memories.filter(
      (m) => m.session_id !== null && !resolved.has(m.session_id),
    );
    if (dangling.length > 0) {
      groups.push({
        id: "__deleted_session__",
        label: "Conversation no longer exists",
        caption: "The chat was cleared, but what it taught the agent survives",
        memories: dangling,
        muted: true,
      });
    }

    const handWritten = memories.filter((m) => m.session_id === null);
    if (handWritten.length > 0) {
      groups.push({
        id: "__by_hand__",
        label: "Added by hand",
        caption: "Written on /memory rather than learned in a conversation",
        memories: handWritten,
      });
    }

    return groups;
  }, [memories, overview]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Memory Insights"
        hint="Read-only. Where each memory came from, which conversations can see it, and the exact text the model receives. Edit them on the Memory page."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/memory">Manage memory</Link>
          </Button>
        }
      />

      {/* Above the fetch on purpose: this explains the mechanism, which is
          worth reading while the data loads and still worth reading when the
          backend is down and the lists below are empty. */}
      <MemoryFlowPanel />

      {overview === null ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Loading memory…
        </p>
      ) : error ? (
        <EmptyState
          icon={Brain}
          title="Could not load memory"
          description={error}
        />
      ) : memories.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="Nothing remembered yet"
          description="Once the agent calls remember() — or you add one on the Memory page — it will show up here, grouped by project and by the conversation it came from."
          action={
            <Button size="sm" asChild>
              <Link href="/memory">Go to Memory</Link>
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue="project">
          <TabsList variant="line">
            <TabsTrigger value="project">By project</TabsTrigger>
            <TabsTrigger value="session">By session</TabsTrigger>
            <TabsTrigger value="prompt">Prompt preview</TabsTrigger>
          </TabsList>

          <TabsContent value="project">
            <MemoryGroupList
              groups={byProject}
              emptyIcon={FolderGit2}
              emptyTitle="No memories to group"
            />
          </TabsContent>

          <TabsContent value="session">
            <MemoryGroupList
              groups={bySession}
              emptyIcon={MessagesSquare}
              emptyTitle="No memories to group"
            />
          </TabsContent>

          <TabsContent value="prompt">
            <PromptPreview
              preview={preview}
              projects={projects}
              scope={previewScope}
              onScopeChange={setPreviewScope}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function PromptPreview({
  preview,
  projects,
  scope,
  onScopeChange,
}: {
  preview: MemoryPreview | null;
  projects: ProjectLabel[];
  scope: string | null;
  onScopeChange: (next: string | null) => void;
}) {
  const budget = preview?.max_system_prompt_chars ?? 0;
  const share = budget > 0 && preview ? (preview.char_count / budget) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Scope</span>
        <ScopePill active={scope === null} onClick={() => onScopeChange(null)}>
          Global chat
        </ScopePill>
        {projects.map((project) => (
          <ScopePill
            key={project.id}
            active={scope === project.id}
            onClick={() => onScopeChange(project.id)}
          >
            {project.name}
          </ScopePill>
        ))}
      </div>

      <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[11px] leading-snug">
        This is the literal text appended to the system prompt for a turn in
        this scope — composed by the same code path the agent loop uses, not a
        reconstruction. Memories are composed <strong>after</strong> skills, so
        if the prompt ever exceeds its budget, they are the first thing cut.
      </div>

      {preview === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading preview…
        </p>
      ) : preview.block === "" ? (
        <EmptyState
          icon={Brain}
          title="Nothing in scope"
          description="No memory applies here, so no <memories> block is added to the prompt at all."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-muted/40">
            <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre">
              {preview.block}
            </pre>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {preview.memory_count}{" "}
            {preview.memory_count === 1 ? "memory" : "memories"} ·{" "}
            {preview.char_count.toLocaleString()} characters of the{" "}
            {budget.toLocaleString()} shared with the base prompt, the agent
            preset and its skills ({share < 0.1 ? "<0.1" : share.toFixed(1)}%).
          </p>
        </>
      )}
    </div>
  );
}

function ScopePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
