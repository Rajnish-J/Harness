"use client";

import { Bot, Plug, Sparkles, X } from "lucide-react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isPresetEmpty } from "@/lib/chat-preset";

/**
 * What is attached to the next message, shown above the input.
 *
 * Chips rather than text in the box: an attachment is structured state the user
 * can remove one piece at a time, and it has to survive editing the message.
 *
 * Individual tools are deliberately absent. The allowlist is now expressed as
 * "everything except…" as often as "only these", so rendering one chip per
 * allowed tool would fill this row with a list the Tools pill already shows as
 * a count.
 */
export default function AttachmentChips() {
  const { preset, setAgent, detachSkill, toggleMcp, catalog } = useChatPreset();

  if (isPresetEmpty(preset)) return null;

  return (
    <ScrollArea className="max-h-24">
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
        {preset.agent && (
          <Chip
            icon={<Bot className="size-3" />}
            label={preset.agent.name}
            onRemove={() => void setAgent(null)}
            primary
          />
        )}

        {preset.skills.map((skill) => (
          <Chip
            key={skill.id}
            icon={<Sparkles className="size-3" />}
            label={skill.name}
            onRemove={() => detachSkill(skill.id)}
          />
        ))}

        {preset.mcpServers.map((server) => (
          <Chip
            key={server.id}
            icon={<Plug className="size-3" />}
            label={server.name}
            onRemove={() => {
              const full = catalog.mcp.find((s) => s.id === server.id);
              if (full) toggleMcp(full);
            }}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function Chip({
  icon,
  label,
  onRemove,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onRemove: () => void;
  primary?: boolean;
}) {
  return (
    <Badge
      variant={primary ? "default" : "secondary"}
      className="gap-1 pr-1 font-normal"
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-sm opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}
