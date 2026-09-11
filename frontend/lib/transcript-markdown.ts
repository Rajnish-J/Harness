import type { TranscriptItem } from "@/lib/types";

/**
 * A conversation, as markdown you can paste anywhere.
 *
 * Derived from the rendered transcript rather than fetched: `items` already
 * holds everything, in the order it was shown, and both a live stream and a
 * repainted history produce the same shapes. An endpoint would have to
 * re-derive exactly this from project_chat_messages. Same reasoning as
 * lib/workspace-changes.ts.
 *
 * The asymmetry between the two message kinds is the thing to keep straight:
 * assistant text is ALREADY markdown -- components/chat/Markdown.tsx renders
 * it -- so it passes through untouched, while user text is literal (see the
 * comment in MessageBubble.tsx) and has to be fenced.
 */

/** Longest run of backticks anywhere in `text`. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

/**
 * Wrap literal text in a fence long enough to contain it.
 *
 * A fence rather than backslash-escaping: escaping would have to handle a
 * dozen metacharacters and their interactions, and would still mangle a
 * pasted shell snippet. Fencing preserves the bytes exactly.
 *
 * The length matters -- someone who pasted a ```fenced block``` into the chat
 * would otherwise break straight out of a three-backtick fence.
 */
function fence(text: string): string {
  const ticks = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${ticks}\n${text}\n${ticks}`;
}

function decision(value: "approved" | "denied" | undefined): string {
  if (value === "approved") return "approved";
  if (value === "denied") return "declined";
  return "no decision";
}

function renderItem(item: TranscriptItem): string {
  switch (item.kind) {
    case "user":
      return `### You\n\n${fence(item.text)}`;

    case "assistant":
      return `### Harness\n\n${item.text}`;

    case "error":
      return `> **[${item.code}]** ${item.message}`;

    case "step": {
      // The arguments say what happened; `result` is deliberately omitted.
      // Tool output is unbounded -- one read_file of a large file would make
      // "copy the chat" produce a megabyte nobody wanted to paste.
      const header = `- \`${item.name}\` — ${item.status}`;
      const args = Object.keys(item.arguments).length
        ? `\n\n  \`\`\`json\n${JSON.stringify(item.arguments, null, 2)}\n  \`\`\``
        : "";
      return header + args;
    }

    case "tool_selection": {
      // Worth exporting: it is the reason the steps below it are the steps
      // that ran, and a transcript missing it reads as an agent that
      // inexplicably ignored half its toolset.
      const summary = item.ran
        ? `Selected ${item.selected.length} of ${item.poolSize} tools`
        : `All ${item.poolSize} tools offered`;
      const detail = item.note || item.reason;
      const names = item.selected.length
        ? `\n\n  ${item.selected.map((tool) => `\`${tool.name}\``).join(", ")}`
        : "";
      return `- _${summary}${detail ? ` — ${detail}` : ""}_${names}`;
    }

    case "approval":
      return `- \`${item.name}\` — ${decision(item.decision)}`;

    case "project_proposal":
      return `- Proposed a new project **${item.name}** — ${decision(item.decision)}${
        item.description ? `\n\n  ${item.description}` : ""
      }`;

    case "attach_proposal":
      return `- Proposed filing this chat under **${item.projectName}** — ${decision(
        item.decision,
      )}${item.reason ? `\n\n  ${item.reason}` : ""}`;

    case "mcp_consent": {
      // Exported because it explains a gap: without it a declined turn reads as
      // a message the agent simply never answered.
      const names = item.servers.map((server) => server.name).join(", ");
      const verdict =
        item.decision === "approved"
          ? "allowed"
          : item.decision === "declined"
            ? "declined"
            : "awaiting a decision";
      const what = item.missing || !names
        ? "Asked for an MCP server that is not registered"
        : `Asked to use the **${names}** MCP ${
            item.servers.length === 1 ? "server" : "servers"
          }`;
      return `- ${what} — ${verdict}${item.reason ? `\n\n  ${item.reason}` : ""}`;
    }

    case "turn_summary":
      // Exported as one line rather than a table: what survives a paste into
      // an issue is the cost, not the breakdown.
      return `- _Completed in ${item.steps} ${
        item.steps === 1 ? "step" : "steps"
      } — ${(item.inputTokens + item.outputTokens).toLocaleString()} tokens (${item.inputTokens.toLocaleString()} in / ${item.outputTokens.toLocaleString()} out)_`;

    default: {
      // Exhaustiveness, and the closest thing this file has to a test: a new
      // TranscriptItem kind fails the build here rather than being silently
      // dropped from every exported conversation.
      const never: never = item;
      return never;
    }
  }
}

export function transcriptToMarkdown(
  items: TranscriptItem[],
  now: Date = new Date(),
): string {
  const body = items.map(renderItem).join("\n\n");
  // A pasted transcript with no provenance is confusing; two lines is enough.
  const header = `# Harness chat\n\n_Exported ${now.toISOString()}_`;
  return `${header}\n\n${body}\n`.replace(/\n{3,}/g, "\n\n");
}
