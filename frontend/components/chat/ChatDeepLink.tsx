"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useChatPreset } from "./ChatPresetProvider";
import { useChatSession } from "./ChatSessionProvider";

/**
 * Drains a "Use in chat" link: /?agent=slug, /?skill=slug, /?mcp=name, and
 * /?session=id from the chat menu's Share item.
 *
 * A query param rather than a context call before router.push, because that
 * only works for soft navigation — it silently does nothing on a refresh,
 * middle-click, or pasted URL. This survives all three and is shareable.
 *
 * The effect calls a stable context action rather than a setState, and the ref
 * makes it idempotent under Strict Mode's double invocation.
 */
export default function ChatDeepLink() {
  const params = useSearchParams();
  const router = useRouter();
  const { applyFromQuery } = useChatPreset();
  const { openSession } = useChatSession();
  const applied = useRef<string | null>(null);

  useEffect(() => {
    const key = params.toString();
    if (!key || applied.current === key) return;
    applied.current = key;

    // A shared conversation link. Handled first and exclusively: it replaces
    // the whole transcript, so pairing it with preset params in one URL would
    // be ambiguous about which wins.
    const session = params.get("session");
    if (session) {
      void openSession(session).then((ok) => {
        if (ok) router.replace("/", { scroll: false });
      });
      return;
    }

    void applyFromQuery(params).then((ok) => {
      // Clean the URL only on success, so a slug that matched nothing stays
      // visible instead of vanishing with no explanation.
      if (ok) router.replace("/", { scroll: false });
    });
  }, [params, applyFromQuery, openSession, router]);

  return null;
}
