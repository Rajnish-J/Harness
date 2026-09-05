"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeArea } from "@/components/ui/code-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Assistant prose, rendered as markdown.
 *
 * Before this existed the text was a plain string child under
 * whitespace-pre-wrap, so ```fences and | pipe | tables | printed literally.
 *
 * Styling is an explicit component map rather than @tailwindcss/typography:
 * `prose` ships its own colour scale that would have to be remapped onto every
 * shadcn token under .dark, and its default measure is wrong inside the 26rem
 * chat rail. Thirty lines of map buys per-element control and reuses the ui/
 * primitives, so a GFM table lands looking native.
 *
 * Deliberately NOT used for user messages: someone typing *text* or pasting a
 * shell snippet means the literal characters.
 */

function buildComponents(compact: boolean): Components {
  return {
    p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="mb-3 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-3 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>
    ),
    li: ({ children }) => <li className="[&>p]:mb-0">{children}</li>,
    h1: ({ children }) => (
      <h1 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-sm font-semibold first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 hover:text-primary"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-3 border-l-2 pl-3 italic text-muted-foreground last:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4" />,

    // GFM tables through the existing primitives. Table brings its own
    // overflow-x-auto wrapper, so a wide table scrolls instead of stretching
    // the rail.
    table: ({ children }) => (
      <div className="mb-3 min-w-0 last:mb-0">
        <Table className={compact ? "text-[11px]" : "text-xs"}>{children}</Table>
      </div>
    ),
    thead: ({ children }) => <TableHeader>{children}</TableHeader>,
    tbody: ({ children }) => <TableBody>{children}</TableBody>,
    tr: ({ children }) => <TableRow>{children}</TableRow>,
    th: ({ children }) => (
      <TableHead className="h-8 px-2">{children}</TableHead>
    ),
    td: ({ children }) => <TableCell className="px-2 py-1.5">{children}</TableCell>,

    // A passthrough, or CodeArea's own <pre> nests inside this one -- invalid
    // HTML and doubled padding.
    pre: ({ children }) => <>{children}</>,

    code: ({ className, children }) => {
      const match = /language-(\w+)/.exec(className ?? "");
      const text = String(children).replace(/\n$/, "");

      // react-markdown v9+ dropped the `inline` prop, so a block is detected
      // by its language class or by containing a newline.
      if (!match && !text.includes("\n")) {
        return (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {children}
          </code>
        );
      }

      return (
        <CodeArea
          code={text}
          language={match?.[1] ?? "text"}
          compact={compact}
        />
      );
    },
  };
}

const PAGE_COMPONENTS = buildComponents(false);
const RAIL_COMPONENTS = buildComponents(true);

const PLUGINS = [remarkGfm];

function MarkdownImpl({
  children,
  compact = false,
  className,
}: {
  children: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 break-words leading-relaxed text-foreground",
        compact ? "text-xs" : "text-sm",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={PLUGINS}
        components={compact ? RAIL_COMPONENTS : PAGE_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoised on the text itself.
 *
 * MessageList maps the whole items array on every SSE event, so without this
 * every finished message re-parses its markdown each time a new one arrives.
 * Note this codebase does not stream token deltas -- each assistant_message
 * event is a complete message -- so per-token reparsing is not a cost being
 * paid here, and no streaming-aware deferral is warranted.
 */
export default memo(
  MarkdownImpl,
  (a, b) =>
    a.children === b.children &&
    a.compact === b.compact &&
    a.className === b.className,
);
