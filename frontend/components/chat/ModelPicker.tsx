"use client";

import { Check, ChevronDown, Cpu } from "lucide-react";
import { useState } from "react";

import { useChatPreset } from "@/components/chat/ChatPresetProvider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatContext, formatPrice, type ModelInfo } from "@/lib/models";

/**
 * Which model runs this turn.
 *
 * The catalog comes from the harness because only it knows which provider is
 * configured — models belonging to the other provider are shown but not
 * selectable, which is more useful than hiding them and leaving the operator
 * wondering where Sonnet went.
 */
export default function ModelPicker() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const { preset, catalog, setModel } = useChatPreset();

  const models = catalog.models.models;
  const activeId = preset.model ?? preset.agent?.model ?? catalog.models.default;
  const active = models.find((model) => model.id === activeId);
  const detail = models.find((model) => model.id === hovered) ?? active ?? models[0];

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

      <PopoverContent align="start" className="w-[34rem] max-w-[90vw] p-0">
        {models.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            The harness reported no models. Check that it is running.
          </p>
        ) : (
          <div className="flex">
            <ScrollArea
              className="max-h-72 w-44 shrink-0 border-r"
              onMouseLeave={() => setHovered(null)}
            >
              <ul className="p-1.5">
                {models.map((model) => (
                  <li key={model.id}>
                    <button
                      type="button"
                      disabled={!model.available}
                      onMouseEnter={() => setHovered(model.id)}
                      onFocus={() => setHovered(model.id)}
                      onClick={() => {
                        // Selecting the configured default clears the override
                        // rather than pinning it, so the turn keeps following
                        // the harness if its configuration changes.
                        setModel(model.default ? null : model.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
                    >
                      <span className="truncate">{model.label}</span>
                      {!model.available && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          n/a
                        </span>
                      )}
                      {model.id === activeId && (
                        <Check className="ml-auto size-3.5 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>

            {detail && <ModelDetail model={detail} asOf={catalog.models.pricing_as_of} />}
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
        {!model.available && " · not configured on this harness"}
      </p>

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
