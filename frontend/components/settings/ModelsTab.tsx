import SectionHeader from "@/components/registry/SectionHeader";
import { Panel, PanelEmpty } from "@/components/settings/SettingsPanel";
import { Badge } from "@/components/ui/badge";
import { formatContext, formatPrice, type ModelCatalog } from "@/lib/models";
import type { HarnessConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The catalog the harness serves, with the one it is actually running marked.
 *
 * `default` and `running` are not the same claim and the page used to show only
 * the first: default is what the catalog nominates, running is what
 * /api/config reports. They agree until someone overrides ANTHROPIC_MODEL, and
 * that is exactly when you are looking at this page.
 */
export default function ModelsTab({
  catalog,
  config,
  settled,
}: {
  catalog: ModelCatalog;
  config: HarnessConfig | null;
  settled: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Catalog"
          hint="Models belonging to a provider this deployment is not running are listed but unavailable."
        />
        <Panel>
          {catalog.models.length === 0 ? (
            <PanelEmpty
              settled={settled}
              loading="Loading models…"
              empty="No catalog reported."
            />
          ) : (
            <>
              {catalog.models.map((model) => (
                <div
                  key={model.id}
                  className="border-b px-4 py-3 last:border-b-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        !model.available && "text-muted-foreground",
                      )}
                    >
                      {model.label}
                    </span>
                    {model.id === config?.model && (
                      <Badge variant="default">running</Badge>
                    )}
                    {model.default && <Badge variant="secondary">default</Badge>}
                    {!model.available && (
                      <Badge variant="outline">other provider</Badge>
                    )}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {model.id}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {formatContext(model.context_tokens) ?? "—"} ctx ·{" "}
                      {formatPrice(model.input_per_mtok)} in ·{" "}
                      {formatPrice(model.output_per_mtok)} out
                    </span>
                  </div>
                  {model.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {model.description}
                    </p>
                  )}
                </div>
              ))}
              {catalog.pricing_as_of && (
                <p className="px-4 py-2 text-[11px] text-muted-foreground">
                  Prices per million tokens, hand-maintained as of{" "}
                  {catalog.pricing_as_of}.
                </p>
              )}
            </>
          )}
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Sampling"
          hint="Listed because their absence is a design decision, not an oversight."
        />
        <Panel>
          <div className="p-4 text-sm text-muted-foreground">
            <p>
              This harness exposes no temperature or top-p control — neither
              parameter is sent, so both sit at the provider&apos;s own default.
              The response ceiling is a fixed{" "}
              <code className="font-mono text-xs">max_tokens = 16000</code>,
              hardcoded in the client constructors rather than read from{" "}
              <code className="font-mono text-xs">.env</code>.
            </p>
            <p className="mt-2">
              Per-turn overrides exist for the model and the iteration cap only,
              and are set by the agent preset a chat is running under.
            </p>
          </div>
        </Panel>
      </section>
    </div>
  );
}
