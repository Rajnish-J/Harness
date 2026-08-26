"use client";

import { Bot } from "lucide-react";
import Link from "next/link";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";

/**
 * Shows the attached agent from anywhere in the app.
 *
 * Read-only on purpose: the composer owns the one interactive switcher, and two
 * competing ones would make it unclear which is authoritative. Clicking here
 * goes to the chat, where it can be changed.
 */
export default function ActiveAgentBadge() {
  const { preset } = useChatPreset();
  if (!preset.agent) return null;

  return (
    <Link
      href="/"
      title="Active chat agent"
      className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent"
    >
      <Bot className="size-3" />
      <span className="max-w-32 truncate">{preset.agent.name}</span>
    </Link>
  );
}
