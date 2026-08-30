"use client";

import { ArrowLeft, MessageSquare, PanelLeft } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

import ChatPresetProvider from "@/components/chat/ChatPresetProvider";
import ChatSessionProvider from "@/components/chat/ChatSessionProvider";
import ChatWindow from "@/components/chat/ChatWindow";
import ConnectGithubDialog from "@/components/projects/ConnectGithubDialog";
import ContainerStatusBadge from "@/components/projects/ContainerStatusBadge";
import FileTree from "@/components/projects/FileTree";
import GitHubActionBar from "@/components/projects/GitHubActionBar";
import { Button } from "@/components/ui/button";
import type { Credential } from "@/lib/credential-types";
import type { Project } from "@/lib/project-types";
import { scopeForProject } from "@/lib/session";
import type { TranscriptItem } from "@/lib/types";

/**
 * Monaco is large and only this route uses it. next/dynamic with ssr:false
 * keeps it out of every other page's bundle, the same trick WorkflowCanvas uses
 * for the React Flow stylesheet. It also genuinely cannot render on the server:
 * it measures a DOM node.
 */
const CodeEditor = dynamic(() => import("@/components/projects/CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
});

/**
 * The project IDE.
 *
 * Layout follows WorkflowEditor: a full-bleed flex column that bypasses
 * PageBody, owns its own toolbar, and keeps panel visibility in local state.
 *
 * The important part is the nested provider pair. ChatSessionProvider and
 * ChatPresetProvider are already mounted once in the root layout for the chat
 * on `/`. Mounting a second pair here, with this project's scope, means React
 * resolves context to the nearer one — so ChatWindow and everything under it
 * bind to the project's conversation without a single change to any of those
 * components, and the global chat is left completely alone.
 */
export default function ProjectIde({
  project,
  initialMessages,
  credentials,
}: {
  project: Project;
  initialMessages: TranscriptItem[];
  credentials: Credential[];
}) {
  const [chatOpen, setChatOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
          <Link href="/projects">
            <ArrowLeft className="size-3.5" />
            Projects
          </Link>
        </Button>

        <span className="truncate text-sm font-semibold">{project.name}</span>

        {project.repoUrl ? (
          <>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {project.repoOwner}/{project.repoName}
            </span>
            <span className="mx-1 h-4 w-px bg-border" />
            <GitHubActionBar projectId={project.id} />
          </>
        ) : (
          <>
            <span className="truncate text-[11px] text-muted-foreground">
              Blank project — not linked to a remote
            </span>
            <span className="mx-1 h-4 w-px bg-border" />
            <ConnectGithubDialog projectId={project.id} credentials={credentials} />
          </>
        )}

        <span className="ml-auto flex items-center gap-2">
          <ContainerStatusBadge projectId={project.id} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setTreeOpen((v) => !v)}
            title="Toggle the file tree"
          >
            <PanelLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setChatOpen((v) => !v)}
            title="Toggle the chat"
          >
            <MessageSquare className="size-3.5" />
          </Button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {chatOpen && (
          <aside className="flex w-[26rem] min-w-0 shrink-0 flex-col border-r">
            <ChatPresetProvider>
              <ChatSessionProvider
                scope={scopeForProject(project.id)}
                projectId={project.id}
                initialItems={initialMessages}
              >
                <ChatWindow />
              </ChatSessionProvider>
            </ChatPresetProvider>
          </aside>
        )}

        {treeOpen && (
          <aside className="w-64 shrink-0 border-r">
            <FileTree
              projectId={project.id}
              selected={selected}
              onSelect={setSelected}
            />
          </aside>
        )}

        <main className="min-h-0 min-w-0 flex-1">
          {/* Keyed by path: a different file gets a fresh editor rather than
              needing an effect to reset the previous file's draft. */}
          <CodeEditor key={selected} projectId={project.id} path={selected} />
        </main>
      </div>
    </div>
  );
}
