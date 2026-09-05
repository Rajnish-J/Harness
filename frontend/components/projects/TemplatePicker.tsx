"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { projectsApi } from "@/lib/project-api";
import type { ProjectTemplate } from "@/lib/project-types";

/**
 * The scaffold catalog, as a row of chips.
 *
 * Shared by NewProjectDialog and the chat's ProjectProposalCard so the two
 * surfaces cannot drift on what "blank" means or how a fetch failure behaves.
 *
 * Degrading matters more than completeness here: if the harness is unreachable
 * the catalog is unknown, but "blank" is always valid, so the picker falls back
 * to it rather than blocking a project from being created at all.
 */

const BLANK_ONLY: ProjectTemplate[] = [
  { id: "blank", name: "Blank", description: "An empty git repository with a README." },
];

export function useProjectTemplates() {
  const [templates, setTemplates] = useState<ProjectTemplate[]>(BLANK_ONLY);

  useEffect(() => {
    let live = true;
    projectsApi
      .listTemplates()
      .then((catalog) => {
        if (live && catalog.templates.length > 0) setTemplates(catalog.templates);
      })
      .catch(() => {
        // Already showing the fallback; a scaffold picker is not worth a toast.
      });
    return () => {
      live = false;
    };
  }, []);

  return templates;
}

export default function TemplatePicker({
  templates,
  value,
  onChange,
  disabled = false,
}: {
  templates: ProjectTemplate[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selected = templates.find((template) => template.id === value);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            disabled={disabled}
            aria-pressed={template.id === value}
            onClick={() => onChange(template.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              template.id === value
                ? "border-foreground/30 bg-foreground text-background"
                : "border-border bg-transparent hover:bg-muted",
            )}
          >
            {template.name}
          </button>
        ))}
      </div>
      {selected && (
        <p className="text-[11px] text-muted-foreground">{selected.description}</p>
      )}
    </div>
  );
}
