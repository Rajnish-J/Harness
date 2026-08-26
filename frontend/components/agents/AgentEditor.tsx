"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import UseInChatButton from "@/components/chat/UseInChatButton";
import EditorShell from "@/components/registry/EditorShell";
import {
  CheckboxList,
  TextAreaField,
  TextField,
  ToggleField,
} from "@/components/registry/fields";
import { agentsApi, mcpApi, skillsApi } from "@/lib/registry-api";
import type {
  Agent,
  McpServerSummary,
  SkillSummary,
} from "@/lib/registry-types";
import { fetchTools, type ToolInfo } from "@/lib/workflow-api";

export default function AgentEditor({ agent }: { agent: Agent }) {
  const router = useRouter();
  const [draft, setDraft] = useState(agent);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [servers, setServers] = useState<McpServerSummary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTools(controller.signal).then(setTools);
    // Attachment lists are best-effort: an unreachable database should leave
    // the rest of the form editable rather than blanking the page.
    skillsApi.list().then(setSkills).catch(() => setSkills([]));
    mcpApi.list().then(setServers).catch(() => setServers([]));
    return () => controller.abort();
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(agent),
    [draft, agent],
  );

  function patch<K extends keyof Agent>(key: K, value: Agent[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  // Attachments are id arrays in jsonb, not foreign keys, so a deleted skill
  // leaves a dangling id behind. Drop those on save rather than showing a
  // checkbox with nothing to check.
  function liveIds(ids: string[], known: { id: string }[]): string[] {
    if (known.length === 0) return ids;
    const present = new Set(known.map((k) => k.id));
    return ids.filter((id) => present.has(id));
  }

  return (
    <EditorShell
      title={agent.name}
      dirty={dirty}
      actions={<UseInChatButton kind="agent" value={agent.slug} />}
      deleteLabel={`Delete the agent "${agent.name}"? This cannot be undone.`}
      onSave={async () => {
        await agentsApi.update(agent.id, {
          slug: draft.slug,
          name: draft.name,
          description: draft.description,
          systemPrompt: draft.systemPrompt,
          model: draft.model,
          maxIterations: draft.maxIterations,
          skillIds: liveIds(draft.skillIds, skills),
          mcpServerIds: liveIds(draft.mcpServerIds, servers),
          toolNames: draft.toolNames,
          enabled: draft.enabled,
        });
      }}
      onDelete={async () => {
        await agentsApi.remove(agent.id);
        router.push("/agents");
      }}
    >
      <TextField label="Name" value={draft.name} onChange={(v) => patch("name", v)} />

      <TextField
        label="Slug"
        hint="How workflows and the API refer to this agent. Must be unique."
        value={draft.slug}
        onChange={(v) => patch("slug", v)}
      />

      <TextField
        label="Description"
        value={draft.description ?? ""}
        placeholder="What this agent is for"
        onChange={(v) => patch("description", v || null)}
      />

      <TextAreaField
        label="System prompt"
        hint="Prepended to every conversation this agent runs."
        rows={12}
        mono
        value={draft.systemPrompt}
        onChange={(v) => patch("systemPrompt", v)}
      />

      <TextField
        label="Model"
        hint="Leave empty to inherit the harness default shown in the sidebar."
        value={draft.model ?? ""}
        placeholder="claude-opus-5"
        onChange={(v) => patch("model", v || null)}
      />

      <TextField
        label="Max iterations"
        hint="Leave empty to inherit the harness default."
        type="number"
        value={draft.maxIterations?.toString() ?? ""}
        onChange={(v) => {
          const parsed = Number.parseInt(v, 10);
          patch("maxIterations", Number.isInteger(parsed) && parsed > 0 ? parsed : null);
        }}
      />

      <CheckboxList
        label="Tools"
        hint="Leave empty to grant every registered tool."
        options={tools.map((tool) => ({
          value: tool.name,
          label: tool.name,
          description: tool.description,
        }))}
        selected={draft.toolNames}
        onChange={(v) => patch("toolNames", v)}
        emptyMessage="No tools reported. Is the Python harness running?"
      />

      <CheckboxList
        label="Skills"
        options={skills.map((skill) => ({
          value: skill.id,
          label: skill.slug,
          description: skill.description ?? skill.name,
        }))}
        selected={draft.skillIds}
        onChange={(v) => patch("skillIds", v)}
        emptyMessage="No skills defined yet."
      />

      <CheckboxList
        label="MCP servers"
        options={servers.map((server) => ({
          value: server.id,
          label: server.name,
          description: server.description ?? server.transport,
        }))}
        selected={draft.mcpServerIds}
        onChange={(v) => patch("mcpServerIds", v)}
        emptyMessage="No MCP servers configured yet."
      />

      <ToggleField
        label="Enabled"
        hint="Disabled agents stay saved but are not offered for new runs."
        checked={draft.enabled}
        onChange={(v) => patch("enabled", v)}
      />
    </EditorShell>
  );

}
