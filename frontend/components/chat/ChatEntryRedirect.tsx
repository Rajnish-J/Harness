"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { chatPath } from "@/lib/chat-routes";
import { getOrCreateSessionId } from "@/lib/session";

/**
 * Turns bare `/` into a real chat URL.
 *
 * A server redirect cannot do this: which conversation you had open lives in
 * localStorage, which only the browser can read. So `/` renders a skeleton and
 * this component, and the address bar catches up a moment later.
 *
 * `getOrCreateSessionId` collapses the two cases -- it returns the stored id,
 * or mints and stores one -- so "reopen my last chat" and "start my first one"
 * are the same call, already guarded against localStorage throwing in private
 * browsing.
 *
 * Any other query params are carried across, so a link like
 * `/?agent=reviewer` still applies its preset once it lands on the real route.
 */
export default function ChatEntryRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    // A legacy share link, from before conversations had their own URLs. It
    // names the chat to open, so it wins over whatever localStorage holds.
    const rest = new URLSearchParams(params);
    const shared = rest.get("session");
    rest.delete("session");

    const target = shared ?? getOrCreateSessionId(null);
    const query = rest.toString();

    // replace, never push: `/` immediately redirects forward, so a history
    // entry here would make Back bounce the user straight back to where they
    // came from and read as a broken button.
    router.replace(chatPath(target) + (query ? `?${query}` : ""), {
      scroll: false,
    });
  }, [params, router]);

  return null;
}
