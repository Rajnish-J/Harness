import { FlaskConical, KeyRound } from "lucide-react";
import Link from "next/link";

import SectionHeader from "@/components/registry/SectionHeader";
import { Panel, Row } from "@/components/settings/SettingsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { flags, MOCK_SURFACES } from "@/lib/flags";
import {
  formatBytes,
  formatChars,
  formatCount,
  formatSeconds,
} from "@/lib/settings-format";
import type { HarnessConfig } from "@/lib/types";

/**
 * The ceilings, timeouts and switches that decide why something refused.
 *
 * Every one of these was previously only in backend/.env, which meant that
 * "run_tests said no command is configured" and "my skill got truncated" were
 * both answerable only by reading a file on the server. All read-only: the
 * endpoint behind them is pydantic-settings with no write path.
 */
export default function AdvancedTab({
  config,
}: {
  config: HarnessConfig | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Limits"
          hint="Hit any of these and the tool truncates or refuses rather than failing later in the model call."
        />
        <Panel>
          <Row
            label="Max file bytes"
            value={formatBytes(config?.limits?.max_file_bytes)}
            hint="read_file refuses above this."
          />
          <Row
            label="Command timeout"
            value={formatSeconds(config?.limits?.command_timeout_seconds)}
          />
          <Row
            label="Max command output"
            value={formatBytes(config?.limits?.max_command_output_bytes)}
            hint="Output past this is truncated, not discarded."
          />
          <Row
            label="System prompt budget"
            value={formatChars(config?.limits?.max_system_prompt_chars)}
            hint="Shared by the base prompt, the agent, attached skills and memories together. Nothing warns when it truncates."
          />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Project commands"
          hint="run_tests, run_lint and run_build each refuse with a clear message when their command is unset — deliberately, rather than guessing a framework."
        />
        <Panel>
          <CommandRow label="Test" command={config?.commands?.test} />
          <CommandRow label="Lint" command={config?.commands?.lint} />
          <CommandRow label="Build" command={config?.commands?.build} />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Workflows"
          hint="A graph past any of these is rejected at validation rather than part-way through a run."
        />
        <Panel>
          <Row
            label="Max nodes"
            value={formatCount(config?.workflows?.max_nodes)}
          />
          <Row
            label="Max supersteps"
            value={formatCount(config?.workflows?.max_supersteps)}
            hint="Counts super-steps, not node visits — a wide graph burns this faster than its node count suggests."
          />
          <Row
            label="Max node output"
            value={formatChars(config?.workflows?.max_node_output_chars)}
            hint="What enters graph state. Full output still goes to the run's step record."
          />
          <Row
            label="Max interpolated"
            value={formatChars(config?.workflows?.max_interpolated_chars)}
          />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="MCP"
          hint="Timeouts for talking to MCP servers, and whether every configured server is attached without being asked for."
        />
        <Panel>
          <Row
            label="Attach all servers"
            value={
              config?.mcp ? (
                <Badge
                  variant={config.mcp.attach_all_enabled ? "secondary" : "outline"}
                >
                  {config.mcp.attach_all_enabled ? "on" : "off"}
                </Badge>
              ) : (
                "—"
              )
            }
            hint="Off by default: the tool list is part of the prompt, so auto-attaching every server inflates the cost of every chat."
          />
          <Row label="Connect" value={formatSeconds(config?.mcp?.connect_timeout)} />
          <Row label="List tools" value={formatSeconds(config?.mcp?.list_timeout)} />
          <Row label="Tool call" value={formatSeconds(config?.mcp?.tool_timeout)} />
          <Row label="Idle" value={formatSeconds(config?.mcp?.idle_timeout)} />
          <Row
            label="Retry cooldown"
            value={formatSeconds(config?.mcp?.retry_cooldown)}
            hint="How long a server that failed to start is left alone, so a broken one is not respawned on every message."
          />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Mock surfaces"
          hint="Inlined into the bundle at build time, so changing one means editing frontend/.env and restarting next dev — a hot reload will not pick it up."
        />
        <Panel>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <FlaskConical className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium">
              {flags.mockAll
                ? "NEXT_PUBLIC_MOCK_ALL is on — it forces every surface below except Tools."
                : "Individual surfaces only — NEXT_PUBLIC_MOCK_ALL is off."}
            </span>
          </div>
          {MOCK_SURFACES.map((surface) => (
            <div key={surface.key} className="border-b px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{surface.label}</span>
                <Badge variant={surface.on ? "secondary" : "outline"}>
                  {surface.on ? "mock" : "live"}
                </Badge>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {surface.key}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {surface.describes}
              </p>
            </div>
          ))}
        </Panel>
        <p className="text-xs text-muted-foreground">
          Credentials and projects have no mock branch at all — they hit Postgres
          whatever these say, and will error while everything around them renders.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Network"
          hint="Which browser origins the harness will answer. A request from anywhere else is rejected before it reaches a route."
        />
        <Panel>
          {config?.cors_origins?.length ? (
            config.cors_origins.map((origin) => (
              <Row key={origin} label="Allowed origin" value={origin} mono />
            ))
          ) : (
            <Row label="Allowed origins" value="—" />
          )}
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Secrets"
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/credentials">Manage credentials</Link>
            </Button>
          }
        />
        <Panel>
          <div className="flex items-start gap-3 p-4">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Access tokens and per-project environment variables live on their own
              page, encrypted at rest with{" "}
              <code className="font-mono text-xs">CREDENTIALS_ENCRYPTION_KEY</code>.
              There is no key rotation path: changing that key makes every stored
              secret undecryptable.
            </p>
          </div>
        </Panel>
      </section>
    </div>
  );
}

/**
 * `null` is the interesting case and gets a badge: the command is genuinely
 * unset, so run_tests will refuse. `undefined` only means the config has not
 * arrived yet, and should look like every other unloaded row rather than like
 * a deliberate answer.
 */
function CommandRow({
  label,
  command,
}: {
  label: string;
  command: string | null | undefined;
}) {
  if (command === undefined) return <Row label={label} value="—" />;

  return (
    <Row
      label={label}
      mono={command !== null}
      value={command ?? <Badge variant="outline">not set</Badge>}
    />
  );
}
