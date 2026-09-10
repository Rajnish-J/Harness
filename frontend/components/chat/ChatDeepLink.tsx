"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { chatPath } from "@/lib/chat-routes";

import { useChatPreset } from "./ChatPresetProvider";

/**
 * Drains a "Use in chat" link: ?agent=slug, ?skill=slug, ?mcp=name, and the
 * legacy ?session=id share link, which now redirects to /chat/<id>.
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
  const pathname = usePathname();
  const { applyFromQuery } = useChatPreset();
  const applied = useRef<string | null>(null);

  useEffect(() => {
    const key = params.toString();
    if (!key || applied.current === key) return;
    applied.current = key;

    // A share link from before conversations had their own URLs. Now that
    // they do, this is purely a redirect to the canonical one -- the route
    // itself adopts the session. Handled first and exclusively: it names a
    // whole different conversation, so pairing it with preset params in one
    // URL would be ambiguous about which wins.
    const session = params.get("session");
    if (session) {
      router.replace(chatPath(session), { scroll: false });
      return;
    }

    void applyFromQuery(params).then((ok) => {
      // Clean the URL only on success, so a slug that matched nothing stays
      // visible instead of vanishing with no explanation.
      //
      // Back to the CURRENT path, not "/": this route is /chat/<id> now, and
      // sending it to "/" would hand it to the entry redirect, which resolves
      // localStorage -- quite possibly a different conversation than the one
      // the preset was just applied to.
      if (ok) router.replace(pathname, { scroll: false });
    });
  }, [params, applyFromQuery, pathname, router]);

  return null;
}
