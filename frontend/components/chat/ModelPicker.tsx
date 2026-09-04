"use client";

import { Check, ChevronDown, Cpu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatContext,
  formatPrice,
  groupByProvider,
  statusBadge,
  type ModelInfo,
} from "@/lib/models";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

const BADGE_TONES = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
} as const;

/**
 * Which model runs this turn.
 *
 * The catalog comes from the harness because only it knows which provider keys
 * are registered, and therefore what is actually selectable. Models with no key
 * behind them are shown greyed out rather than hidden — "you have not set this
 * up" is a more useful answer than silence, and the empty state below turns it
 * into a link to the page that fixes it.
 *
 * Health is rendered on the row rather than left for the turn to discover. An
 * expired or rejected key used to be invisible here and only surfaced as a red
 * bubble after you had already typed a message and pressed send; the badge and
 * the detail pane's verdict line exist to move that discovery earlier.
 */
export default function ModelPicker() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const { preset, catalog, setModel } = useChatPreset();

  // Only models whose provider has a key registered in Credentials → Models.
  // `credential_source` is the distinction that matters: "db" is a key someone
  // actually registered, "env" is a backend/.env fallback that is a placeholder
  // in every checkout, and listing those made four Anthropic models look ready
  // to use when the first turn would have failed on a fake key.
  const models = catalog.models.models.filter(
    (model) => model.credential_source === "db",
  );
  const reported = catalog.models.models.length;
  // The harness's own default can be a model we just filtered out — it reads
  // LLM_PROVIDER from backend/.env, which points at Anthropic in a fresh
  // checkout. Fall back to the first model with a real key so the trigger never
  // names a model the list does not offer.
  const preferredId = preset.model ?? preset.agent?.model ?? catalog.models.default;
  const usable = preferredId !== null && models.some((m) => m.id === preferredId);
  const fallbackId = models[0]?.id ?? null;
  const activeId = usable ? preferredId : fallbackId;
  const active = models.find((model) => model.id === activeId);
  const detail = models.find((model) => model.id === hovered) ?? active ?? models[0];
  const groups = groupByProvider(models);

  // Pin that fallback into the preset, because the displayed model and the one
  // the turn runs on are two different values: presetToBody only sends `model`
  // when preset.model is set, so leaving it null would send nothing and let the
  // backend fall back to its own default — the very model we filtered out.
  useEffect(() => {
    if (!usable && fallbackId !== null && preset.model !== fallbackId) {
      setModel(fallbackId);
    }
  }, [usable, fallbackId, preset.model, setModel]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs font-normal"
          aria-label={`Model: ${active?.label ?? activeId ?? "default"}`}
        >
          <Cpu className="size-3.5 opacity-70" />
          {active?.label ?? activeId ?? "Model"}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        // Opens upward, and flips only if the top runs out of room. The trigger
        // lives in the composer at the foot of the page, so a downward panel
        // ran off the bottom of the screen — into the Windows taskbar. The
        // padding keeps a margin from either viewport edge on the flip.
        collisionPadding={{ top: 16, bottom: 16 }}
        className="w-[51rem] max-w-[90vw] p-0"
      >
        {models.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {reported === 0
              ? "The harness reported no models. Check that it is running."
              : "No provider keys registered yet."}{" "}
            <Link href="/credentials" className="underline underline-offset-2">
              Add one
            </Link>
            .
          </p>
        ) : (
          // One flex row, no header above it: the "no key" guidance lives in the
          // detail pane on the right, which is free height, rather than in a
          // banner that would push the list further up the viewport.
          <div className="flex">
            <ScrollArea
              className="max-h-72 w-44 shrink-0 border-r"
              onMouseLeave={() => setHovered(null)}
            >
              <ul className="flex flex-col gap-1 p-1.5">
                {groups.map(([provider, rows]) => (
                  <li key={provider}>
                    {/* Grouped because availability is now a per-PROVIDER
                        fact: one key switches four rows on at once, and a
                        flat list made that look like four coincidences. */}
                    <p className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {provider}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {rows.map((model) => {
                        const badge = statusBadge(model);
                        return (
                          <li key={model.id}>
                            {/* Not the `disabled` attribute: a disabled button
                                fires no pointer events, so an unavailable model
                                could never show the detail pane explaining WHY
                                it is unavailable. Inert-by-handler instead. */}
                            <button
                              type="button"
                              aria-disabled={!model.available}
                              onMouseEnter={() => setHovered(model.id)}
                              onFocus={() => setHovered(model.id)}
                              onClick={() => {
                                if (!model.available) return;
                                // Selecting the harness's own default clears the
                                // override rather than pinning it, so the turn
                                // keeps following the harness if its
                                // configuration changes. Only safe while that
                                // default is a model we actually list: clearing
                                // to null otherwise hands the turn back to the
                                // filtered-out .env default.
                                setModel(model.default && usable ? null : model.id);
                                setOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                                !model.available && "cursor-default opacity-45",
                              )}
                            >
                              <span className="truncate">{model.label}</span>
                              {badge && (
                                <span
                                  className={cn(
                                    "ml-auto shrink-0 text-[10px]",
                                    BADGE_TONES[badge.tone],
                                  )}
                                >
                                  {badge.label}
                                </span>
                              )}
                              {model.id === activeId && (
                                <Check
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    !badge && "ml-auto",
                                  )}
                                />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </ScrollArea>

            {detail && (
              <ModelDetail model={detail} asOf={catalog.models.pricing_as_of} />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ModelDetail({ model, asOf }: { model: ModelInfo; asOf: string }) {
  const context = formatContext(model.context_tokens);

  return (
    <div className="min-w-0 flex-1 p-3">
      <p className="text-sm font-medium">{model.description}</p>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Powered by <span className="font-medium">{model.provider}</span>
        {context && ` · ${context} context`}
        {model.credential_source === "env" && " · key from backend/.env"}
      </p>

      {/* The verdict line. This is the whole point of the health round trip:
          the reason a key failed, in the provider's own words, before a message
          is sent rather than after. */}
      {!model.available ? (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          No API key registered for {model.provider}.{" "}
          <Link href="/credentials" className="underline underline-offset-2">
            Add one
          </Link>
          .
        </p>
      ) : model.status === "rejected" ? (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
          {model.status_message ?? "The last test of this key failed."}
          {model.checked_at && ` · ${relativeTime(model.checked_at)}`}
        </p>
      ) : model.status === "unknown" ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          This key has not been tested yet.
        </p>
      ) : (
        model.checked_at && (
          <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">
            Key verified {relativeTime(model.checked_at)}.
          </p>
        )
      )}

      <dl className="mt-3 flex flex-col gap-1 border-t pt-2 text-[11px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Input tokens</dt>
          <dd className="font-mono">{formatPrice(model.input_per_mtok)}/1M</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Output tokens</dt>
          <dd className="font-mono">{formatPrice(model.output_per_mtok)}/1M</dd>
        </div>
      </dl>

      {asOf && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          List prices as of {asOf}.
        </p>
      )}
    </div>
  );
}
