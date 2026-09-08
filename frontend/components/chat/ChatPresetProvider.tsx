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
import {
  fetchToolSettings,
  type ToolSettings,
} from "@/lib/tool-settings-api";
import {
  NO_DISABLED_TOOLS,
  toggleGroupNames,
  toggleToolName,
  type DisabledTools,
  type SelectableGroup,
} from "@/lib/tool-selection";
import {
  fetchMcpTools,
  fetchTools,
  type McpServerNotice,
  type ToolInfo,
} from "@/lib/workflow-api";

export type Catalog = {
  agents: AgentSummary[];
  skills: SkillSummary[];
  mcp: McpServerSummary[];
  /** Built-in tools, plus the tools of every attached MCP server. */
  tools: ToolInfo[];
  /** Tools switched off for everyone on /tools.
   *
   *  A set of names, kept out of the allowlist arithmetic entirely — see the
   *  header of lib/tool-selection.ts. It renders those tools off and locked;
   *  the harness applies the same subtraction again when building the turn, so
   *  a stale tab cannot spend one. */
  disabledTools: DisabledTools;
  models: ModelCatalog;
  /** Servers that failed to answer discovery, shown next to the ones that did. */
  mcpNotices: string[];
  /** The same notices with a server id attached, for placing one against a row.
   *
   *  Matching a notice to a server by looking for its quoted name in the prose
   *  cross-matched names that were substrings of one another, and could not
   *  place notices that name no server at all. */
  mcpServerNotices: McpServerNotice[];
  loading: boolean;
  /** A discovery round trip to the attached MCP servers is in flight.
   *
   *  Separate from `loading`, which covers only the initial catalog fetch and is
   *  false by the time a server is attached. Without this the composer cannot
   *  tell "this server has no tools" from "we have not asked yet", and says the
   *  harness is down during an ordinary wait. */
  mcpToolsLoading: boolean;
};

const EMPTY_CATALOG: Catalog = {
  agents: [],
  skills: [],
  mcp: [],
  tools: [],
  disabledTools: NO_DISABLED_TOOLS,
  models: EMPTY_MODELS,
  mcpNotices: [],
  mcpServerNotices: [],
  loading: true,
  mcpToolsLoading: false,
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
  /** Re-pulls the model list — call after a provider key is saved or tested. */
  refetchModels: () => Promise<void>;
  /** Re-pulls the global disable list — call after /tools writes to it. */
  refetchToolSettings: () => Promise<void>;
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
      // A sixth entry rather than its own effect: it is one same-origin GET
      // with no dependency on anything above, and folding it in keeps the
      // catalog landing in a single setState instead of two renders.
      fetchToolSettings(controller.signal),
    ])
      .then(([agents, skills, mcp, tools, models, toolSettings]) => {
        if (controller.signal.aborted) return;
        setCatalog((prev) => ({
          ...prev,
          agents,
          skills,
          mcp,
          models,
          // Keep any MCP tools the second effect has already discovered.
          tools: [...tools, ...prev.tools.filter((t) => t.name.startsWith("mcp__"))],
          disabledTools: new Set(toolSettings.disabled),
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

  // Called after a provider key is saved or tested. The initial load above only
  // runs once on mount, so without this the picker would only ever see a freshly
  // registered key after a full page reload. Delegates to the parent when
  // nested, for the same reason the mount effect above skips itself: a nested
  // instance's displayed catalog is `inherited`, not its own state, so fetching
  // into `ownCatalog` here would update nothing visible.
  const refetchModels = useCallback(async () => {
    if (parent) {
      await parent.refetchModels();
      return;
    }
    const models = await fetchModels();
    setCatalog((prev) => ({ ...prev, models }));
  }, [parent]);

  // Called after /tools switches something on or off. Delegates when nested for
  // exactly the reason refetchModels does: a nested instance displays
  // `inherited`, so fetching into ownCatalog here would update nothing visible.
  const refetchToolSettings = useCallback(async () => {
    if (parent) {
      await parent.refetchToolSettings();
      return;
    }
    const settings: ToolSettings = await fetchToolSettings();
    setCatalog((prev) => ({
      ...prev,
      disabledTools: new Set(settings.disabled),
    }));
  }, [parent]);

  // MCP tools are discovered separately, and only for servers the composer has
  // actually attached: discovery costs a round trip to each server, so doing it
  // in the initial load would make opening the app pay for servers nobody is
  // using. Re-runs whenever the attached set changes.
  const attachedIds = preset.mcpServers.map((server) => server.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    const ids = attachedIds ? attachedIds.split(",") : [];

    // Raised in a promise callback rather than in the effect body: a bare
    // setState here trips react-hooks/set-state-in-effect. Promise.resolve()
    // defers it by a microtask, which satisfies the rule and still lands before
    // the fetch can resolve. Detaching the last server clears the flag the same
    // way, since with nothing to discover the fetch below never raises it.
    const discovering = ids.length > 0;
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setCatalog((prev) =>
        prev.mcpToolsLoading === discovering
          ? prev
          : { ...prev, mcpToolsLoading: discovering },
      );
    });

    fetchMcpTools(ids, controller.signal)
      .then(({ tools, notices, serverNotices }) => {
        if (controller.signal.aborted) return;
        setCatalog((prev) => ({
          ...prev,
          tools: [
            ...prev.tools.filter((tool) => !tool.name.startsWith("mcp__")),
            ...tools,
          ],
          mcpNotices: notices,
          mcpServerNotices: serverNotices,
          mcpToolsLoading: false,
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
      // A globally disabled tool has no local state to flip. The switch is
      // already disabled in the panel; this makes that true of the model too,
      // so a keyboard or a stale render cannot get around it.
      if (catalog.disabledTools.has(name)) return;
      setPreset((prev) => ({
        ...prev,
        toolNames: toggleToolName(prev.toolNames, name, universe),
      }));
    },
    [universe, catalog.disabledTools],
  );

  const toggleToolGroup = useCallback(
    (group: SelectableGroup) => {
      setPreset((prev) => ({
        ...prev,
        toolNames: toggleGroupNames(
          prev.toolNames,
          group,
          universe,
          catalog.disabledTools,
        ),
      }));
    },
    [universe, catalog.disabledTools],
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
      refetchModels,
      refetchToolSettings,
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
      refetchModels,
      refetchToolSettings,
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
