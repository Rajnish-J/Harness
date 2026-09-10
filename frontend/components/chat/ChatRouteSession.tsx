"use client";

import { useEffect } from "react";

import { useChatSession } from "./ChatSessionProvider";

/**
 * Points the session provider at the conversation in the URL.
 *
 * The provider lives in the root layout -- it has to, since the sidebar's
 * history list and the header's actions menu both consume it from outside
 * this route, and unmounting it on navigation would abort an in-flight turn.
 * So the route cannot pass the id down as a prop; it renders this instead,
 * which reaches up through context and adopts it.
 *
 * `adoptSession` is idempotent and stable, so this fires once per id: on
 * mount, and again whenever the segment changes -- which is what makes the
 * browser's Back button move between conversations.
 */
export default function ChatRouteSession({ id }: { id: string }) {
  const { adoptSession } = useChatSession();

  useEffect(() => {
    adoptSession(id);
  }, [id, adoptSession]);

  return null;
}
