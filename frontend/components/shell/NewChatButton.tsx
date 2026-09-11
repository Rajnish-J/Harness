"use client";

import { SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { chatPath } from "@/lib/chat-routes";

export default function NewChatButton() {
  const { newChat } = useChatSession();
  const { clearAttachments } = useChatPreset();
  const router = useRouter();

  function start() {
    const id = newChat();
    // Wired here rather than inside newChat so the session provider does not
    // have to depend on the preset provider.
    clearAttachments();
    // The new chat needs its own URL, from wherever the button was pressed.
    // newChat has already rotated the store to this id, so ChatRouteSession
    // mounts, sees it is already the open session, and does nothing -- no
    // second clear, no pointless fetch.
    //
    // push, not replace: "New chat" is a deliberate act, and Back should
    // return to the conversation it was pressed from.
    router.push(chatPath(id));
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
