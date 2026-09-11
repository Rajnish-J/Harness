"use client";

import { BookOpen, Check, Plug, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { useChatSession } from "@/components/chat/ChatSessionProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { declineMcpServers } from "@/lib/api";
import type { TranscriptItem } from "@/lib/types";

type Consent = Extract<TranscriptItem, { kind: "mcp_consent" }>;

/**
 * "This needs the GitHub server. Shall I use it?"
 *
 * Registering a server on /mcp does not attach it to a chat. Before this
 * existed that gap was silent and it lied: the model was never told the server
 * existed, so it apologised for a capability the user had already set up and
 * suggested they go run the CLI themselves.
 *
 * The router now sees every enabled server's catalog, and when a request needs
 * one it is not allowed to touch, the turn parks HERE -- before the expensive
 * model runs and before anything reaches the session history. That is why this
 * is not an ApprovalCard: there is no parked tool call to release, so approving
 * re-sends the message with the server attached rather than resuming a turn.
 *
 * Asked in a MODAL rather than inline, because this is the one transcript item
 * that BLOCKS: the turn is parked and nothing else will happen until it is
 * answered. An inline card can be scrolled past and left sitting there, which
 * reads as a stalled chat rather than as a question. Everything else in the
 * transcript reports something that already happened, and stays inline.
 *
 * Consent lasts the conversation, not the turn. A three-message GitHub
 * conversation should ask once.
 */
export default function McpConsentCard({ item }: { item: Consent }) {
  const { send, sessionId } = useChatSession();
  const { preset, toggleMcp } = useChatPreset();
  const [decision, setDecision] = useState<Consent["decision"]>(item.decision);
  // Dismissing with Escape or the overlay means "not now", NOT "no". It is not
  // a decline: nothing is recorded, the server is not remembered as refused,
  // and the summary line below still offers the question. Treating a stray
  // Escape as a permanent refusal would silently switch off a capability the
  // user had just gone to the trouble of registering.
  const [open, setOpen] = useState(true);
  // Answered, tracked outside render. `disabled` below is a rendered property
  // and cannot stop a handler that fires twice within one commit -- a double
  // click, or a StrictMode double-invoke. Both handlers below re-send or record
  // a decision, so both must happen exactly once.
  const answered = useRef(false);

  const names = item.servers.map((server) => server.name).join(", ");
  const one = item.servers.length === 1;
  // Nothing registered can serve this. There is no server to approve, so the
  // only useful action is pointing at the catalog.
  const missing = item.missing || item.servers.length === 0;

  function accept() {
    if (answered.current) return;
    answered.current = true;
    // Attach for the rest of the conversation, then re-send. The preset is
    // rebuilt here rather than read back from context because setPreset is
    // async -- `send` would otherwise post the toolset from before the toggle
    // and park on the very same question again.
    const added = item.servers.filter(
      (server) => !preset.mcpServers.some((s) => s.id === server.id),
    );
    for (const server of added) {
      toggleMcp({ id: server.id, name: server.name });
    }

    setDecision("approved");
    setOpen(false);
    // `replay`: this message is already in the transcript, above this card.
    // Re-sending is how the turn resumes -- nothing was parked server-side to
    // release -- but the bubble must not be printed twice.
    void send(
      item.message,
      { ...preset, mcpServers: [...preset.mcpServers, ...added] },
      { replay: true },
    );
  }

  function decline() {
    if (answered.current) return;
    answered.current = true;
    setDecision("declined");
    setOpen(false);
    if (sessionId) {
      // So the next message does not ask the same question again.
      void declineMcpServers(
        sessionId,
        item.servers.map((server) => server.id),
      );
    }
  }

  return (
    <>
      {/* The transcript line. Always present, so the conversation still reads
          top-to-bottom afterwards and the question is reachable again if the
          dialog was dismissed rather than answered. */}
      <ConsentLine
        decision={decision}
        names={names}
        missing={missing}
        onReopen={() => setOpen(true)}
      />

      <Dialog open={open && !decision} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug
                className={
                  missing
                    ? "size-4 shrink-0 text-amber-600 dark:text-amber-400"
                    : "size-4 shrink-0 text-sky-600 dark:text-sky-400"
                }
                aria-hidden
              />
              {missing ? (
                "This needs an MCP server you don't have yet"
              ) : (
                <span>
                  Use the <span className="font-mono">{names}</span>{" "}
                  {one ? "server" : "servers"} for this?
                </span>
              )}
            </DialogTitle>

            {item.reason && (
              <DialogDescription>{item.reason}</DialogDescription>
            )}
          </DialogHeader>

          {!missing && (
            <p className="text-sm text-muted-foreground">
              You registered {one ? "it" : "them"} but haven&apos;t switched{" "}
              {one ? "it" : "them"} on for this chat. Allowing stays for the
              rest of this conversation — remove it from the composer any time.
            </p>
          )}

          <DialogFooter>
            {missing ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDecision("declined")}
                >
                  <X className="size-4" />
                  Cancel
                </Button>
                <Button asChild>
                  <Link href="/mcp">
                    <BookOpen className="size-4" />
                    Browse the catalog
                  </Link>
                </Button>
              </>
            ) : (
              <>
                {/* Gated on `decision` ALONE.

                    Not on `pending`: the backend sets that the moment it
                    parks this turn (mcp_consent is followed immediately by
                    done/awaiting_approval), so it is true for as long as
                    this dialog is on screen. Disabling on it locked both
                    buttons permanently and made the question unanswerable.
                    `pending` means "the COMPOSER is waiting on a verdict"
                    -- and this dialog is how that verdict is given.

                    Not on `streaming` either: the park ends the stream, so
                    it is false here; and were a later change to leave it
                    set, it would be the same lockout in a rarer disguise.
                    `answered` in the handlers is what makes a double click
                    safe, which is a job a rendered flag cannot do. */}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!decision}
                  onClick={decline}
                >
                  <X className="size-4" />
                  Don&apos;t
                </Button>
                <Button
                  type="button"
                  disabled={!!decision}
                  onClick={accept}
                >
                  <Check className="size-4" />
                  Use {one ? "it" : "them"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The one line this leaves in the transcript.
 *
 * Three states, because the dialog has three exits: answered yes, answered no,
 * and dismissed without answering. The third is the one worth designing for --
 * it must not look like a refusal, and it must offer the question back.
 */
function ConsentLine({
  decision,
  names,
  missing,
  onReopen,
}: {
  decision: Consent["decision"];
  names: string;
  missing: boolean;
  onReopen: () => void;
}) {
  if (decision) {
    return (
      <p className="px-2 font-mono text-[11px] text-muted-foreground">
        {decision === "approved" ? "using" : "not using"}{" "}
        {names || "any MCP server"}
      </p>
    );
  }

  return (
    <p className="px-2 font-mono text-[11px] text-muted-foreground">
      {missing ? "needs an MCP server that is not registered" : `needs ${names}`}
      {" — "}
      <button
        type="button"
        onClick={onReopen}
        className="underline underline-offset-2 hover:text-foreground"
      >
        decide
      </button>
    </p>
  );
}
