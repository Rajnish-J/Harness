"use client";

import { Bot } from "lucide-react";
import { useState } from "react";

import AgentPickerDialog from "@/components/chat/AgentPickerDialog";
import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";

/**
 * Which agent this turn runs as, as a pill in the composer's control row.
 *
 * It sits beside +, mode, tools and model rather than on its own line above
 * them: the agent is one of the settings for the next message, and floating it
 * outside the box made the most consequential of them look like a caption.
 *
 * The picking itself is a modal (AgentPickerDialog), not a dropdown — see the
 * note there on why this one control does not share the popover shape.
 */
export default function AgentSwitcher() {
  const [open, setOpen] = useState(false);
  const { preset } = useChatPreset();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal"
        aria-label={`Agent: ${preset.agent?.name ?? "none"}`}
        onClick={() => setOpen(true)}
      >
        <Bot className="size-3.5 opacity-70" />
        {preset.agent?.name ?? "No agent"}
      </Button>

      <AgentPickerDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
