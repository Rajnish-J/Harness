/**
 * A believable fake chat stream.
 *
 * Signature-compatible with streamChat, so lib/api.ts just delegates and
 * ChatSessionProvider.applyEvent is not touched at all.
 *
 * Three details make the difference between "looks real" and "obviously fake":
 *
 * 1. A tool_call and its tool_result share one id. That id is the key
 *    applyEvent folds on to merge the pair into a single transcript step; a
 *    mismatch renders two orphaned rows.
 * 2. assistant_message is a WHOLE message, not a token delta. Emitting it in
 *    pieces would stack N separate bubbles rather than streaming one.
 * 3. Aborting rejects with a real AbortError, so the `name !== "AbortError"`
 *    check in the provider's catch swallows it exactly as it does a cancelled
 *    fetch, and the Stop button behaves identically.
 */

import type { ToolMode } from "@/lib/chat-preset";
import type { AgentEvent } from "@/lib/types";

/** Rejects on abort rather than resolving, so the caller unwinds like fetch. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

type Round = {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  isError?: boolean;
};

type Script = {
  opening: string;
  rounds: Round[];
  closing: string;
};

function scriptFor(message: string, toolNames: string[]): Script {
  const text = message.toLowerCase();
  const can = (name: string) => toolNames.length === 0 || toolNames.includes(name);

  if (/\b(error|fail|broken|crash)\b/.test(text)) {
    return {
      opening: "Let me look at what is failing.",
      rounds: [
        {
          tool: "read_file",
          args: { path: "config/settings.toml" },
          result: "read_file: no such file or directory: 'config/settings.toml'",
          isError: true,
        },
        {
          tool: "list_directory",
          args: { path: "." },
          result: "config/\nsrc/\nREADME.md\npackage.json",
        },
      ].filter((r) => can(r.tool)),
      closing:
        "That path does not exist — the file is `config/settings.json`, not `.toml`. The error was a stale path in the loader, not a missing file.",
    };
  }

  if (/\b(write|create|add|make|draft)\b/.test(text)) {
    return {
      opening: "I will write the file and then read it back to confirm.",
      rounds: [
        {
          tool: "write_file",
          args: {
            path: "notes.md",
            content:
              "# Agent loops\n\n- The loop is a for-range over max_iterations.\n- Tool dispatch is gated by name.\n- Disconnect ends the loop with no done frame.",
          },
          result: "Wrote 152 bytes to notes.md",
        },
        {
          tool: "read_file",
          args: { path: "notes.md" },
          result:
            "# Agent loops\n\n- The loop is a for-range over max_iterations.\n- Tool dispatch is gated by name.\n- Disconnect ends the loop with no done frame.",
        },
      ].filter((r) => can(r.tool)),
      closing:
        "Written and verified — `notes.md` has three bullets on agent loops, and reading it back returned exactly what was written.",
    };
  }

  if (/\b(list|files|directory|dir|ls|tree)\b/.test(text)) {
    return {
      opening: "Listing the workspace.",
      rounds: [
        {
          tool: "list_directory",
          args: { path: "." },
          result: "README.md\nnotes.md\nsrc/\n  index.ts\n  loop.ts\ntests/\n  loop.test.ts",
        },
      ].filter((r) => can(r.tool)),
      closing:
        "Four entries at the root: `README.md`, `notes.md`, and the `src/` and `tests/` directories.",
    };
  }

  if (/\b(read|show|open|cat|view)\b/.test(text)) {
    return {
      opening: "Reading that now.",
      rounds: [
        {
          tool: "read_file",
          args: { path: "README.md" },
          result:
            "# Harness\n\nAn AI coding agent harness, built from scratch.\n\nNot yet built: memory persistence, auth.",
        },
      ].filter((r) => can(r.tool)),
      closing:
        "The README is short: a one-line description plus a list of what is not built yet.",
    };
  }

  return {
    opening: "Let me get oriented before answering.",
    rounds: [
      {
        tool: "list_directory",
        args: { path: "." },
        result: "README.md\nnotes.md\nsrc/\ntests/",
      },
    ].filter((r) => can(r.tool)),
    closing:
      "This is mock mode, so nothing here reached a real model — but the transcript is shaped exactly like a live turn, tool rounds included.",
  };
}

export type MockChatPreset = {
  agentName?: string | null;
  skillNames?: string[];
  toolNames?: string[];
  mode?: ToolMode;
};

/**
 * Manual mode is a two-request protocol, so the fixture has to remember what it
 * parked. Keyed by session id, exactly like the real SessionStore, and cleared
 * on resume — which is also what makes a second approve of the same call fail
 * here the way it fails against Python.
 */
const parked = new Map<string, { rounds: Round[]; closing: string }>();

export async function streamMockApproval(
  params: {
    sessionId: string;
    decisions: { id: string; approved: boolean }[];
    signal?: AbortSignal;
  },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const pending = parked.get(params.sessionId);
  parked.delete(params.sessionId);

  if (!pending) {
    onEvent({
      type: "error",
      code: "no_pending_approval",
      message: "There is no tool call waiting for approval in this session.",
    });
    onEvent({ type: "done", reason: "error" });
    return;
  }

  const approved = new Map(params.decisions.map((d) => [d.id, d.approved]));
  let denied = 0;

  let counter = 0;
  for (const round of pending.rounds) {
    counter += 1;
    const id = `call_mock_${counter}`;
    // A call with no verdict counts as denied, matching resume_agent_loop.
    const ok = approved.get(id) ?? false;
    if (!ok) denied += 1;

    await sleep(400, params.signal);
    onEvent({
      type: "tool_result",
      id,
      name: round.tool,
      is_error: ok ? (round.isError ?? false) : true,
      content: ok
        ? round.result
        : "The user denied this tool call. Do not retry it. Continue without it, or explain what you would need instead.",
    });
  }

  await sleep(600, params.signal);
  onEvent({
    type: "assistant_message",
    text: denied
      ? "Understood — I will leave that alone and work without it."
      : pending.closing,
  });
  onEvent({ type: "done", reason: "end_turn" });
}

export async function streamMockChat(
  params: {
    sessionId: string;
    message: string;
    preset?: MockChatPreset;
    signal?: AbortSignal;
  },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const preset = params.preset ?? {};
  const toolNames = preset.toolNames ?? [];
  const script = scriptFor(params.message, toolNames);
  // Chat mode advertises no tools, so the fixture must not narrate any.
  if (preset.mode === "chat") script.rounds = [];

  // Feels like time-to-first-token rather than an instant reply.
  await sleep(450, params.signal);

  const prefix: string[] = [];
  if (preset.agentName) prefix.push(`Running as **${preset.agentName}**.`);
  if (preset.skillNames?.length) {
    prefix.push(`Skills in play: ${preset.skillNames.join(", ")}.`);
  }

  onEvent({
    type: "assistant_message",
    text: prefix.length ? `${prefix.join(" ")}\n\n${script.opening}` : script.opening,
  });

  if (preset.mode === "manual" && script.rounds.length > 0) {
    // Park instead of running, and stop the stream: the turn resumes through
    // streamMockApproval, exactly as the real one resumes through
    // POST /api/chat/approve.
    parked.set(params.sessionId, {
      rounds: script.rounds,
      closing: script.closing,
    });

    let pendingCounter = 0;
    for (const round of script.rounds) {
      pendingCounter += 1;
      await sleep(300, params.signal);
      onEvent({
        type: "approval_request",
        id: `call_mock_${pendingCounter}`,
        name: round.tool,
        arguments: round.args,
      });
    }

    onEvent({ type: "done", reason: "awaiting_approval" });
    return;
  }

  let counter = 0;
  for (const round of script.rounds) {
    counter += 1;
    const id = `call_mock_${counter}`;

    await sleep(300, params.signal);
    onEvent({ type: "tool_call", id, name: round.tool, arguments: round.args });

    await sleep(550, params.signal);
    onEvent({
      type: "tool_result",
      id,
      name: round.tool,
      is_error: round.isError ?? false,
      content: round.result,
    });
  }

  await sleep(700, params.signal);
  onEvent({ type: "assistant_message", text: script.closing });
  onEvent({ type: "done", reason: "end_turn" });
}
