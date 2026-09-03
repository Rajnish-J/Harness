"use client";

import { Brain, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import MemoryDialog from "@/components/memory/MemoryDialog";
import EmptyState from "@/components/registry/EmptyState";
import ResourceCard from "@/components/registry/ResourceCard";
import SectionHeader from "@/components/registry/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { memoryApi, type Memory } from "@/lib/memory-api";
import { projectsApi } from "@/lib/project-api";
import type { Project } from "@/lib/project-types";
import { relativeTime } from "@/lib/relative-time";

/**
 * What the agent remembers across sessions.
 *
 * Fetched in the browser rather than server-rendered, for the same reason
 * ToolsBrowser is: this data lives behind the Python harness at API_BASE, not
 * in Drizzle, so a server-side fetch would block the page on Python being up.
 *
 * The scope switch mirrors how the backend reads memory: global rows reach
 * every conversation, so they are always listed; picking a project adds that
 * project's rows on top. There is no "everything, everywhere" view because
 * no single chat ever sees one.
 */
export default function MemoryBrowser() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [creating, setCreating] = useState(false);

  /** Re-read after a write. Event handlers only — the effect below has its own
   *  copy, because setState inside an effect body cascades renders. */
  const reload = useCallback(async () => {
    try {
      setMemories(await memoryApi.list(projectId));
      setError(null);
    } catch (err) {
      setMemories([]);
      setError((err as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    memoryApi
      .list(projectId, controller.signal)
      .then((rows) => {
        setMemories(rows);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setMemories([]);
        setError(err.message);
      });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    // A failure here only costs the scope switch its project buttons; the
    // global list still loads, so it is swallowed rather than surfaced.
    projectsApi.list().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function remove(memory: Memory) {
    try {
      await memoryApi.remove(memory.id);
      toast.success(`Forgot “${memory.title}”.`);
      await reload();
    } catch (err) {
      toast.error({
        title: "Could not forget this memory",
        description: (err as Error).message,
      });
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = (memories ?? []).filter(
    (memory) =>
      !needle ||
      memory.title.toLowerCase().includes(needle) ||
      memory.content.toLowerCase().includes(needle),
  );

  const projectName = projects.find((p) => p.id === projectId)?.name ?? null;
  const newButton = (
    <Button size="sm" onClick={() => setCreating(true)}>
      New memory
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Memory"
        hint="What the agent carries between conversations. Every chat in scope reads these at the start of each turn, so something learned in one session reaches the others."
        action={newButton}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">Scope</Label>
          <div className="flex flex-wrap gap-2">
            <ScopeButton
              active={projectId === null}
              label="Global"
              onClick={() => setProjectId(null)}
            />
            {projects.map((project) => (
              <ScopeButton
                key={project.id}
                active={projectId === project.id}
                label={project.name}
                onClick={() => setProjectId(project.id)}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {projectId
              ? "Global memories plus this project's — exactly what this project's chats see."
              : "Memories that reach every project and the global chat."}
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter memories"
            className="pl-8"
          />
        </div>
      </div>

      {memories === null ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Loading memory…
        </p>
      ) : error ? (
        <EmptyState
          icon={Brain}
          title="Could not load memory"
          description={error}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={needle ? "No memories match" : "Nothing remembered yet"}
          description={
            needle
              ? `Nothing matches “${query}”.`
              : "The agent writes here itself when it learns something durable — or add one by hand."
          }
          action={needle ? undefined : newButton}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((memory) => (
            <li key={memory.id}>
              <ResourceCard
                icon={Brain}
                tone={memory.project_id ? "purple" : "sky"}
                title={memory.title}
                kind={memory.kind}
                meta={
                  <span className="flex flex-col gap-1">
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {memory.content}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {memory.project_id ? "This project" : "Global"} ·{" "}
                      {memory.source === "agent" ? "written by the agent" : "added by hand"}{" "}
                      · {relativeTime(memory.updated_at)}
                    </span>
                  </span>
                }
                action={
                  <span className="flex w-full gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditing(memory)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => remove(memory)}
                    >
                      Forget
                    </Button>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <MemoryDialog
          key={editing?.id ?? "new"}
          memory={editing}
          projectId={projectId}
          projectName={projectName}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function ScopeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
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
      {label}
    </button>
  );
}
