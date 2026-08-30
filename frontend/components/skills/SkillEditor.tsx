"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  CheckboxList,
  TextAreaField,
  TextField,
  ToggleField,
} from "@/components/registry/fields";
import UseInChatButton from "@/components/chat/UseInChatButton";
import EditorShell from "@/components/registry/EditorShell";
import { skillsApi } from "@/lib/registry-api";
import type { Skill } from "@/lib/registry-types";
import { fetchTools, type ToolInfo } from "@/lib/workflow-api";

export default function SkillEditor({ skill }: { skill: Skill }) {
  const router = useRouter();
  const [draft, setDraft] = useState(skill);
  const [tools, setTools] = useState<ToolInfo[]>([]);

  // The tool registry lives in Python, so it is fetched rather than joined.
  // fetchTools already swallows its own errors and returns [].
  useEffect(() => {
    const controller = new AbortController();
    fetchTools(controller.signal).then(setTools);
    return () => controller.abort();
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(skill),
    [draft, skill],
  );

  function patch<K extends keyof Skill>(key: K, value: Skill[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <EditorShell
      title={skill.name}
      backHref="/skills"
      dirty={dirty}
      actions={<UseInChatButton kind="skill" value={skill.slug} />}
      deleteLabel={`Delete the skill "${skill.name}"? This cannot be undone.`}
      onSave={async () => {
        await skillsApi.update(skill.id, {
          slug: draft.slug,
          name: draft.name,
          description: draft.description,
          content: draft.content,
          allowedTools: draft.allowedTools,
          enabled: draft.enabled,
        });
      }}
      onDelete={async () => {
        await skillsApi.remove(skill.id);
        router.push("/skills");
      }}
    >
      <TextField label="Name" value={draft.name} onChange={(v) => patch("name", v)} />

      <TextField
        label="Slug"
        hint="How the agent refers to this skill. Must be unique."
        value={draft.slug}
        onChange={(v) => patch("slug", v)}
      />

      <TextField
        label="Description"
        hint="The 'when to use this' line. Kept short — it stays in context permanently."
        value={draft.description ?? ""}
        placeholder="Use when the user asks to…"
        onChange={(v) => patch("description", v || null)}
      />

      <TextAreaField
        label="Instructions"
        hint="Markdown. Loaded on demand, so this can be as long as it needs to be."
        rows={16}
        mono
        value={draft.content}
        placeholder={"# How to do the thing\n\n1. First…"}
        onChange={(v) => patch("content", v)}
      />

      <CheckboxList
        label="Allowed tools"
        hint="Leave empty to inherit whatever the calling agent already has."
        options={tools.map((tool) => ({
          value: tool.name,
          label: tool.name,
          description: tool.description,
        }))}
        selected={draft.allowedTools}
        onChange={(v) => patch("allowedTools", v)}
        emptyMessage="No tools reported. Is the Python harness running?"
      />

      <ToggleField
        label="Enabled"
        hint="Disabled skills stay saved but are not offered to agents."
        checked={draft.enabled}
        onChange={(v) => patch("enabled", v)}
      />
    </EditorShell>
  );
}
