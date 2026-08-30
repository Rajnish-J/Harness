"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  EMPTY_PRESET,
  type AgentAttachment,
  type ChatPreset,
  type SkillAttachment,
  type ToolMode,
} from "@/lib/chat-preset";
import {
  EMPTY_CATALOG as EMPTY_MODELS,
  fetchModels,
  type ModelCatalog,
} from "@/lib/models";
import { agentsApi, mcpApi, skillsApi } from "@/lib/registry-api";
import type {
  AgentSummary,
  McpServerSummary,
  SkillSummary,
} from "@/lib/registry-types";
import { toggleGroupNames, toggleToolName, type SelectableGroup } from "@/lib/tool-selection";
import { fetchMcpTools, fetchTools, type ToolInfo } from "@/lib/workflow-api";

export type Catalog = {
  agents: AgentSummary[];
  skills: SkillSummary[];
  mcp: McpServerSummary[];
  /** Built-in tools, plus the tools of every attached MCP server. */
  tools: ToolInfo[];
  models: ModelCatalog;
  /** Servers that failed to answer discovery, shown next to the ones that did. */
  mcpNotices: string[];
  loading: boolean;
};

const EMPTY_CATALOG: Catalog = {
  agents: [],
  skills: [],
  mcp: [],
  tools: [],
  models: EMPTY_MODELS,
  mcpNotices: [],
  loading: true,
};

type ChatPresetValue = {
  preset: ChatPreset;
  catalog: Catalog;
  setAgent: (agent: AgentSummary | null) => Promise<void>;
  attachSkill: (skill: SkillSummary) => Promise<void>;
  detachSkill: (id: string) => void;
  toggleTool: (name: string) => void;
  toggleToolGroup: (group: SelectableGroup) => void;
  resetTools: () => void;
  toggleMcp: (server: McpServerSummary) => void;
  setMode: (mode: ToolMode) => void;
  setModel: (id: string | null) => void;
  clearAttachments: () => void;
  /** Applies ?agent= / ?skill= / ?mcp= from a "Use in chat" link. */
  applyFromQuery: (params: URLSearchParams) => Promise<boolean>;
};

const ChatPresetContext = createContext<ChatPresetValue | null>(null);

/**
 * Holds what the composer has attached: an agent, skills, a tool allowlist, and
 * MCP servers.
 *
 * Mounted in the root layout, which React does not remount on navigation. That
 * is what lets "Use in chat" on /skills/[id] survive the trip to /, and what
 * keeps a chosen agent selected while you go look at a workflow.
 */
export default function ChatPresetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preset, setPreset] = useState<ChatPreset>(EMPTY_PRESET);
  const [ownCatalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);

  // A project page mounts a SECOND provider inside the root one so the chat in
  // its side panel is a separate conversation. The *preset* must be per
  // instance — attaching an agent there should not change the composer on `/` —
  // but the catalog is identical global data, so a nested instance inherits it
  // rather than repeating five requests on every project page load.
  const parent = useContext(ChatPresetContext);
  const inherited = parent?.catalog ?? null;

  const catalog = useMemo(() => {
    if (!inherited) return ownCatalog;
    // MCP tools are still discovered per instance, because which servers are
    // attached is part of the preset, not the catalog.
    const own = ownCatalog.tools.filter((tool) => tool.name.startsWith("mcp__"));
    return own.length
      ? { ...inherited, tools: [...inherited.tools, ...own] }
      : inherited;
  }, [inherited, ownCatalog]);

  // Fetched once per page load. setState lands in a .then callback rather than
  // the effect body, which is what keeps react-hooks/set-state-in-effect quiet;
  // same shape as components/tools/ToolsBrowser.tsx.
  useEffect(() => {
    // Nested: the root provider already has this, and re-fetching would only
    // duplicate work and briefly render a second EMPTY_CATALOG.
    if (inherited) return;

    const controller = new AbortController();

    Promise.all([
      agentsApi.list().catch(() => [] as AgentSummary[]),
      skillsApi.list().catch(() => [] as SkillSummary[]),
      mcpApi.list().catch(() => [] as McpServerSummary[]),
      fetchTools(controller.signal),
      fetchModels(controller.signal),
    ])
      .then(([agents, skills, mcp, tools, models]) => {
        if (controller.signal.aborted) return;
        setCatalog((prev) => ({
          ...prev,
          agents,
          skills,
          mcp,
          models,
          // Keep any MCP tools the second effect has already discovered.
          tools: [...tools, ...prev.tools.filter((t) => t.name.startsWith("mcp__"))],
          loading: false,
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCatalog({ ...EMPTY_CATALOG, loading: false });
        }
      });

    return () => controller.abort();
  }, [inherited]);

  // MCP tools are discovered separately, and only for servers the composer has
  // actually attached: discovery costs a round trip to each server, so doing it
  // in the initial load would make opening the app pay for servers nobody is
  // using. Re-runs whenever the attached set changes.
  const attachedIds = preset.mcpServers.map((server) => server.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    const ids = attachedIds ? attachedIds.split(",") : [];

    fetchMcpTools(ids, controller.signal)
      .then(({ tools, notices }) => {
        if (controller.signal.aborted) return;
        setCatalog((prev) => ({
          ...prev,
          tools: [
            ...prev.tools.filter((tool) => !tool.name.startsWith("mcp__")),
            ...tools,
          ],
          mcpNotices: notices,
        }));
      })
      .catch(() => {
        // fetchMcpTools already swallows its own failures; this only catches an
        // abort, which needs no handling.
      });

    return () => controller.abort();
  }, [attachedIds]);

  const setAgent = useCallback(
    async (summary: AgentSummary | null) => {
      if (!summary) {
        setPreset((prev) => ({ ...prev, agent: null }));
        return;
      }

      const full = await agentsApi.get(summary.id);

      // Resolve the agent's saved skill ids to full skills. Ids that no longer
      // resolve are dropped: attachments are stored as jsonb id arrays, not
      // foreign keys, so a deleted skill leaves a dangling reference behind.
      const skills = (
        await Promise.all(
          full.skillIds.map((id) =>
            skillsApi.get(id).catch(() => null),
          ),
        )
      ).filter((skill): skill is Awaited<ReturnType<typeof skillsApi.get>> =>
        skill !== null,
      );

      const attachment: AgentAttachment = {
        id: full.id,
        slug: full.slug,
        name: full.name,
        systemPrompt: full.systemPrompt,
        model: full.model,
        maxIterations: full.maxIterations,
      };

      setPreset((prev) => ({
        ...prev,
        agent: attachment,
        skills: skills.map(toSkillAttachment),
        toolNames: full.toolNames.length > 0 ? full.toolNames : null,
        mcpServers: prev.mcpServers.length
          ? prev.mcpServers
          : full.mcpServerIds
              .map((id) => catalogServer(id))
              .filter((s): s is { id: string; name: string } => s !== null),
      }));

      function catalogServer(id: string) {
        const found = catalog.mcp.find((server) => server.id === id);
        return found ? { id: found.id, name: found.name } : null;
      }
    },
    [catalog.mcp],
  );

  const attachSkill = useCallback(async (summary: SkillSummary) => {
    const full = await skillsApi.get(summary.id);
    setPreset((prev) =>
      prev.skills.some((skill) => skill.id === full.id)
        ? prev
        : { ...prev, skills: [...prev.skills, toSkillAttachment(full)] },
    );
  }, []);

  const detachSkill = useCallback((id: string) => {
    setPreset((prev) => ({
      ...prev,
      skills: prev.skills.filter((skill) => skill.id !== id),
    }));
  }, []);

  // Both toggles are universe-aware: unchecking one tool while inheriting has
  // to mean "everything except this", not "only this". See lib/tool-selection.ts.
  const universe = useMemo(
    () => catalog.tools.map((tool) => tool.name),
    [catalog.tools],
  );

  const toggleTool = useCallback(
    (name: string) => {
      setPreset((prev) => ({
        ...prev,
        toolNames: toggleToolName(prev.toolNames, name, universe),
      }));
    },
    [universe],
  );

  const toggleToolGroup = useCallback(
    (group: SelectableGroup) => {
      setPreset((prev) => ({
        ...prev,
        toolNames: toggleGroupNames(prev.toolNames, group, universe),
      }));
    },
    [universe],
  );

  const setMode = useCallback((mode: ToolMode) => {
    setPreset((prev) => ({ ...prev, mode }));
  }, []);

  const setModel = useCallback((model: string | null) => {
    setPreset((prev) => ({ ...prev, model }));
  }, []);

  const resetTools = useCallback(() => {
    setPreset((prev) => ({ ...prev, toolNames: null }));
  }, []);

  const toggleMcp = useCallback((server: McpServerSummary) => {
    setPreset((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.some((s) => s.id === server.id)
        ? prev.mcpServers.filter((s) => s.id !== server.id)
        : [...prev.mcpServers, { id: server.id, name: server.name }],
    }));
  }, []);

  // Mode and model survive: they are settings with their own controls, not
  // attachments, and silently resetting them here would be a surprise.
  const clearAttachments = useCallback(
    () =>
      setPreset((prev) => ({ ...EMPTY_PRESET, mode: prev.mode, model: prev.model })),
    [],
  );

  const applyFromQuery = useCallback(
    async (params: URLSearchParams): Promise<boolean> => {
      const agentSlug = params.get("agent");
      const skillSlug = params.get("skill");
      const mcpName = params.get("mcp");
      if (!agentSlug && !skillSlug && !mcpName) return false;

      // The catalog may still be in flight on a hard load, so fall back to a
      // direct list rather than silently doing nothing.
      const agents = catalog.agents.length
        ? catalog.agents
        : await agentsApi.list().catch(() => []);
      const skills = catalog.skills.length
        ? catalog.skills
        : await skillsApi.list().catch(() => []);
      const servers = catalog.mcp.length
        ? catalog.mcp
        : await mcpApi.list().catch(() => []);

      let applied = false;

      if (agentSlug) {
        const match = agents.find((agent) => agent.slug === agentSlug);
        if (match) {
          await setAgent(match);
          applied = true;
        }
      }
      if (skillSlug) {
        const match = skills.find((skill) => skill.slug === skillSlug);
        if (match) {
          await attachSkill(match);
          applied = true;
        }
      }
      if (mcpName) {
        const match = servers.find((server) => server.name === mcpName);
        if (match) {
          toggleMcp(match);
          applied = true;
        }
      }

      return applied;
    },
    [catalog, setAgent, attachSkill, toggleMcp],
  );

  const value = useMemo(
    () => ({
      preset,
      catalog,
      setAgent,
      attachSkill,
      detachSkill,
      toggleTool,
      toggleToolGroup,
      resetTools,
      toggleMcp,
      setMode,
      setModel,
      clearAttachments,
      applyFromQuery,
    }),
    [
      preset,
      catalog,
      setAgent,
      attachSkill,
      detachSkill,
      toggleTool,
      toggleToolGroup,
      resetTools,
      toggleMcp,
      setMode,
      setModel,
      clearAttachments,
      applyFromQuery,
    ],
  );

  return (
    <ChatPresetContext.Provider value={value}>
      {children}
    </ChatPresetContext.Provider>
  );
}

function toSkillAttachment(skill: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  content: string;
}): SkillAttachment {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    content: skill.content,
  };
}

export function useChatPreset(): ChatPresetValue {
  const value = useContext(ChatPresetContext);
  if (!value) {
    throw new Error("useChatPreset must be used within a ChatPresetProvider.");
  }
  return value;
}
