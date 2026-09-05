"use client";

import { ArrowLeft, ChevronDown, MessageSquare, PanelLeft } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import ChatPresetProvider from "@/components/chat/ChatPresetProvider";
import ChatSessionProvider from "@/components/chat/ChatSessionProvider";
import ChatWindow from "@/components/chat/ChatWindow";
import ProjectChatSwitcher from "@/components/projects/ide/ProjectChatSwitcher";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import DeleteProjectDialog from "@/components/projects/DeleteProjectDialog";
import EditProjectDialog from "@/components/projects/EditProjectDialog";
import FileTree from "@/components/projects/FileTree";
import GitHubActionBar from "@/components/projects/GitHubActionBar";
import ProjectActionsMenu from "@/components/projects/ProjectActionsMenu";
import ConnectRepositoryDialog from "@/components/projects/ide/ConnectRepositoryDialog";
import ContainerMenu from "@/components/projects/ide/ContainerMenu";
import RepositoryMenu from "@/components/projects/ide/RepositoryMenu";
import ShareMenu from "@/components/projects/ide/ShareMenu";
import VersionHistoryMenu from "@/components/projects/ide/VersionHistoryMenu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Credential } from "@/lib/credential-types";
import { flags } from "@/lib/flags";
import {
  mockDeployments,
  mockShare,
  mockVersions,
  mockVitals,
} from "@/lib/mock/ide";
import type { Project, ProjectListRow } from "@/lib/project-types";
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
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fixtures, computed once per project id. `flags.mockIde` is on by default
  // because none of this has an endpoint yet — see lib/mock/ide.ts. When one
  // arrives, this block becomes the fetch and the rest of the toolbar does not
  // change.
  const versions = flags.mockIde ? mockVersions(project.id) : [];
  const vitals = mockVitals(project.id, flags.mockIde);
  const deployments = flags.mockIde
    ? mockDeployments(project.id)
    : { previewUrl: null, productionUrl: null, previewLive: false };
  const share = mockShare(project.id);

  // ProjectActionsMenu/EditProjectDialog/DeleteProjectDialog are shared with
  // the /projects list page, which is why they take a ProjectListRow rather
  // than the bare Project this page has. Neither dialog reads fileCount for
  // anything but a cosmetic "including N files" hint on delete, so 0 here
  // just omits that hint rather than lying about a real count.
  const listRow: ProjectListRow = { ...project, fileCount: 0 };

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
          <Link href="/projects">
            <ArrowLeft className="size-3.5" />
            Projects
          </Link>
        </Button>

        <ProjectActionsMenu
          project={listRow}
          onEdit={() => setEditing(true)}
          onDelete={() => setDeleting(true)}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 -ml-2"
            >
              <span className="truncate text-sm font-semibold">{project.name}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          }
        />

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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setConnectOpen(true)}
            >
              Connect repository
            </Button>
          </>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setTreeOpen((v) => !v)}
              >
                <PanelLeft className="size-3.5" />
                <span className="sr-only">Toggle the file tree</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {treeOpen ? "Hide file tree" : "Show file tree"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setChatOpen((v) => !v)}
              >
                <MessageSquare className="size-3.5" />
                <span className="sr-only">Toggle the chat</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{chatOpen ? "Hide chat" : "Show chat"}</TooltipContent>
          </Tooltip>

          <VersionHistoryMenu versions={versions} />

          <span className="mx-0.5 h-4 w-px bg-border" />

          <ContainerMenu projectId={project.id} vitals={vitals} />

          <RepositoryMenu
            project={project}
            deployments={deployments}
            onConnect={() => setConnectOpen(true)}
          />

          <ShareMenu
            projectId={project.id}
            projectName={project.name}
            share={share}
            previewUrl={deployments.previewUrl}
          />
        </span>
      </div>

      {/* Mounted only while open, so each open re-reads the repository list
          and starts from clean form state. */}
      {connectOpen && (
        <ConnectRepositoryDialog
          project={project}
          credentials={credentials}
          open
          onOpenChange={setConnectOpen}
        />
      )}

      {editing && (
        <EditProjectDialog
          project={listRow}
          credentials={credentials}
          onOpenChange={setEditing}
        />
      )}

      {deleting && (
        <DeleteProjectDialog
          projects={[listRow]}
          onOpenChange={setDeleting}
          // The project this page is for no longer exists once this lands —
          // staying on /projects/{id}/vscode would be a dead page.
          onDeleted={() => router.push("/projects")}
        />
      )}

      {/* Sizes are pixels, and the defaults are the widths these panes had
          when they were fixed -- becoming draggable should not move anything
          until the user actually drags.

          Keyed on which panes are open: the group tracks children by position,
          so toggling the tree off and on again would otherwise hand the
          editor's stored size to the tree. */}
      <ResizablePanelGroup
        key={`${chatOpen}-${treeOpen}`}
        orientation="horizontal"
        className="flex min-h-0 flex-1"
      >
        {chatOpen && (
          <>
            <ResizablePanel
              defaultSize={416}
              minSize={280}
              maxSize={720}
              className="flex flex-col"
            >
              <ChatPresetProvider>
                <ChatSessionProvider
                  scope={scopeForProject(project.id)}
                  projectId={project.id}
                  initialItems={initialMessages}
                >
                  {/* Inside the provider, deliberately -- see the switcher's
                      own comment. In the toolbar above it would bind to the
                      global chat instead of this project's. */}
                  <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
                    <ProjectChatSwitcher projectId={project.id} />
                  </div>
                  <ChatWindow variant="rail" />
                </ChatSessionProvider>
              </ChatPresetProvider>
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        {treeOpen && (
          <>
            <ResizablePanel defaultSize={256} minSize={160} maxSize={480}>
              <FileTree
                projectId={project.id}
                selected={selected}
                onSelect={setSelected}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        <ResizablePanel minSize={320}>
          {/* Keyed by path: a different file gets a fresh editor rather than
              needing an effect to reset the previous file's draft. */}
          <CodeEditor key={selected} projectId={project.id} path={selected} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
