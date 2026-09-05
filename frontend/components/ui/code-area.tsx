"use client";

import dynamic from "next/dynamic";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A fenced code block: syntax-highlighted, copyable, horizontally scrollable.
 *
 * Shiki is loaded through next/dynamic for the same reason Monaco is (see
 * components/projects/ProjectIde.tsx): react-shiki's web bundle is ~695KB
 * gzipped, and a chat that has not yet shown any code should not pay for it.
 * Until it resolves -- and during SSR, which is disabled -- `PlainPre` renders
 * the identical <pre> shell, so highlighting arriving late recolours the block
 * without moving it.
 *
 * Adapted from RadianUI's CodeArea. Their token names (bg-fill2,
 * text-fg-secondary) do not exist here, so everything is remapped onto this
 * repo's shadcn tokens.
 */

function PlainPre({ code, compact }: { code: string; compact: boolean }) {
  return (
    <pre
      className={cn(
        // Matches what the highlighted <pre> lands on (see the .rs-root rules
        // in app/globals.css), so a slow Shiki chunk does not flash the
        // wrapper's grey and then snap to black.
        "m-0 w-max min-w-full font-mono leading-relaxed dark:bg-black",
        compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2.5 text-xs",
      )}
    >
      <code>{code}</code>
    </pre>
  );
}

const ShikiHighlighter = dynamic(
  () => import("react-shiki/web").then((mod) => mod.ShikiHighlighter),
  {
    ssr: false,
    // Same <pre> shell as the highlighted output, so the chunk arriving late
    // recolours the block in place instead of expanding an empty box.
    loading: () => <PlainPre code="" compact={false} />,
  },
);

export type CodeAreaProps = {
  code: string;
  /** A Shiki language id. Anything outside the web bundle degrades to plain. */
  language?: string;
  lineNumbers?: boolean;
  /** Header label. Pass "" to hide the header strip entirely. */
  filename?: string;
  /** Tighter padding and smaller type, for the project IDE's chat rail. */
  compact?: boolean;
  className?: string;
};

/**
 * Dual themes rather than a `resolvedTheme` branch.
 *
 * next-themes reports `undefined` on the first client render, so branching
 * would highlight once in the wrong palette and again after hydration. Both
 * palettes are emitted instead, and CSS picks the winner.
 *
 * Shiki does NOT switch between them on its own -- that assumption was this
 * component's original bug. With a `themes` object it defaults to
 * `defaultColor: "light"`, which writes the light palette inline on every
 * token and leaves the dark one as a variable nothing reads, so dark mode
 * rendered light code. `defaultColor={false}` below turns that off: tokens
 * then carry only `--shiki-light` and `--shiki-dark` and no colour at all,
 * and the four rules in app/globals.css choose one under `.dark`.
 */
const THEMES = { light: "github-light", dark: "github-dark-default" } as const;

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard is permission-gated and unavailable over plain http on
        // some hosts. The code is still selectable, so this is not worth a toast.
      });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={copied ? "Copied" : "Copy code"}
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={copy}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

export function CodeArea({
  code,
  language = "text",
  lineNumbers = false,
  filename,
  compact = false,
  className,
}: CodeAreaProps) {
  const showHeader = filename !== "";
  const label = filename || language;

  return (
    <div
      className={cn(
        // min-w-0 is load-bearing: without it flexbox's min-width:auto lets one
        // long line push the IDE's 26rem chat rail wider and squeeze the editor.
        "my-3 min-w-0 overflow-hidden rounded-lg border bg-muted first:mt-0 last:mb-0",
        className,
      )}
    >
      {showHeader && (
        <div className="flex items-center gap-2 border-b bg-card px-2 py-1">
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {label}
          </span>
          <span className="flex-1" />
          <CopyButton code={code} />
        </div>
      )}

      {/* Native overflow-x rather than ScrollArea: Radix renders its viewport
          as a nested div that breaks Shiki's own <pre> styling, and a code
          block only ever needs one axis. Never wrap -- wrapped code is worse
          to read than scrolled code. */}
      <div className="overflow-x-auto">
        <ShikiHighlighter
          language={language}
          theme={THEMES}
          // See the THEMES comment: false is what makes both palettes pure
          // variables, so app/globals.css can switch them under `.dark`.
          defaultColor={false}
          showLanguage={false}
          showLineNumbers={lineNumbers}
          addDefaultStyles={false}
          className={cn(
            // No bg-transparent here: with defaultColor off the theme supplies
            // the <pre> background, and letting the wrapper's bg-muted show
            // through is the same light-grey-in-dark-mode symptom in another
            // costume. bg-muted stays as the pre-highlight fallback only.
            "[&_pre]:m-0 [&_pre]:w-max [&_pre]:min-w-full",
            compact
              ? "[&_pre]:px-2 [&_pre]:py-1.5 [&_code]:text-[11px]"
              : "[&_pre]:px-3 [&_pre]:py-2.5 [&_code]:text-xs",
            "[&_code]:font-mono [&_code]:leading-relaxed",
          )}
        >
          {code}
        </ShikiHighlighter>
      </div>
    </div>
  );
}

export default CodeArea;
