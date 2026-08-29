"use client";

import { Bot } from "lucide-react";
import { useState } from "react";

import AgentPickerContent from "@/components/chat/AgentPickerContent";
import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";

/**
 * Which agent this turn runs as, as a pill in the composer's control row —
 * a dropdown like the mode, tools and model pickers beside it, not a modal.
 */
export default function AgentSwitcher() {
  const [open, setOpen] = useState(false);
  const { preset } = useChatPreset();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal"
          aria-label={`Agent: ${preset.agent?.name ?? "none"}`}
        >
          <Bot className="size-3.5 opacity-70" />
          {preset.agent?.name ?? "No agent"}
        </Button>
      </PopoverTrigger>

      {/* Remounted on each open/close so its search query resets without an effect. */}
      <AgentPickerContent
        key={open ? "open" : "closed"}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
}
