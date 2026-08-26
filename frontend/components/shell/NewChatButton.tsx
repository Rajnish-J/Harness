"use client";

import { SquarePen } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export default function NewChatButton() {
  const { newChat } = useChatSession();
  const { clearAttachments } = useChatPreset();
  const router = useRouter();
  const pathname = usePathname();

  function start() {
    newChat();
    // Wired here rather than inside newChat so the session provider does not
    // have to depend on the preset provider.
    clearAttachments();
    // router.push("/") is a no-op when we're already there, which is exactly
    // the case that matters most — the epoch bump handles it instead.
    if (pathname !== "/") router.push("/");
  }

  return (
    <SidebarMenuButton
      onClick={start}
      tooltip="New chat"
      className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
    >
      <SquarePen />
      <span>New chat</span>
    </SidebarMenuButton>
  );
}
