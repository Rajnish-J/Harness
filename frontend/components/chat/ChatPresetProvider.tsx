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
} from "@/lib/chat-preset";
import { agentsApi, mcpApi, skillsApi } from "@/lib/registry-api";
import type {
  AgentSummary,
  McpServerSummary,
  SkillSummary,
} from "@/lib/registry-types";
import { fetchTools, type ToolInfo } from "@/lib/workflow-api";

export type Catalog = {
  agents: AgentSummary[];
  skills: SkillSummary[];
  mcp: McpServerSummary[];
  tools: ToolInfo[];
  loading: boolean;
};

const EMPTY_CATALOG: Catalog = {
  agents: [],
  skills: [],
  mcp: [],
  tools: [],
  loading: true,
};

type ChatPresetValue = {
  preset: ChatPreset;
  catalog: Catalog;
  setAgent: (agent: AgentSummary | null) => Promise<void>;
  attachSkill: (skill: SkillSummary) => Promise<void>;
  detachSkill: (id: string) => void;
  toggleTool: (name: string) => void;
  resetTools: () => void;
  toggleMcp: (server: McpServerSummary) => void;
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
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);

  // Fetched once per page load. setState lands in a .then callback rather than
  // the effect body, which is what keeps react-hooks/set-state-in-effect quiet;
  // same shape as components/tools/ToolsBrowser.tsx.
  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      agentsApi.list().catch(() => [] as AgentSummary[]),
      skillsApi.list().catch(() => [] as SkillSummary[]),
      mcpApi.list().catch(() => [] as McpServerSummary[]),
      fetchTools(controller.signal),
    ])
      .then(([agents, skills, mcp, tools]) => {
        if (controller.signal.aborted) return;
        setCatalog({ agents, skills, mcp, tools, loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCatalog({ ...EMPTY_CATALOG, loading: false });
        }
      });

    return () => controller.abort();
  }, []);

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

  const toggleTool = useCallback((name: string) => {
    setPreset((prev) => {
      const current = prev.toolNames ?? [];
      const next = current.includes(name)
        ? current.filter((tool) => tool !== name)
        : [...current, name];
      // Back to "inherit" rather than "none": an empty allowlist would read as
      // a deliberate choice to grant nothing.
      return { ...prev, toolNames: next.length > 0 ? next : null };
    });
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

  const clearAttachments = useCallback(() => setPreset(EMPTY_PRESET), []);

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
      resetTools,
      toggleMcp,
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
      resetTools,
      toggleMcp,
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
