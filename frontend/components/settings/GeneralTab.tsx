import SectionHeader from "@/components/registry/SectionHeader";
import { Panel, PanelEmpty, Row } from "@/components/settings/SettingsPanel";
import { Badge } from "@/components/ui/badge";
import type { HarnessHealth } from "@/lib/api";
import type { HarnessConfig } from "@/lib/types";

/**
 * What the harness is running right now: the model it will answer with, where
 * it writes, and whether the three optional secrets are present.
 *
 * That last panel is the reason this tab is first. A missing DATABASE_URL or
 * CREDENTIALS_ENCRYPTION_KEY does not stop the app booting — it makes
 * workflows, credentials and memory 503 much later, somewhere that does not
 * mention the key. Stating it here turns that into one glance.
 */
export default function GeneralTab({
  config,
  health,
  settled,
}: {
  config: HarnessConfig | null;
  health: HarnessHealth | null;
  settled: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Runtime"
          hint="Read from backend/.env at startup. Changing any of it means editing that file and restarting the Python process — there is no write path over HTTP."
        />
        <Panel>
          {config ? (
            <>
              <Row label="Provider" value={config.provider} />
              <Row label="Model" value={config.model} mono />
              <Row label="Max iterations" value={String(config.max_iterations)} />
              <Row
                label="MCP mocked in harness"
                value={config.mock_mcp ? "yes" : "no"}
                hint="The backend's own switch, separate from the frontend flags under Advanced."
              />
            </>
          ) : (
            <PanelEmpty
              settled={settled}
              loading="Connecting to harness core…"
              empty="Harness core offline — start the Python backend to see its configuration."
            />
          )}
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Storage"
          hint="Where the agent writes files, and the Postgres pool everything else depends on."
        />
        <Panel>
          <Row
            label="Database"
            value={
              <Badge variant={health?.db === "ok" ? "secondary" : "outline"}>
                {health?.db ?? "unknown"}
              </Badge>
            }
            hint="unconfigured means DATABASE_URL is unset, which is why workflows would 503."
          />
          <Row
            label="Workspace root"
            value={config?.workspace_root ?? "—"}
            mono
          />
          <Row
            label="Connection pool"
            value={
              config?.database
                ? `${config.database.pool_min} – ${config.database.pool_max}`
                : "—"
            }
            hint="Minimum and maximum connections held open."
          />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Secrets configured"
          hint="Whether each is set, never its value — the endpoint that feeds this page does not send them."
        />
        <Panel>
          <Row
            label="LLM API key"
            value={<ConfiguredBadge on={config?.secrets?.llm_api_key} />}
            hint="Without it the harness refuses to boot at all, so 'missing' here means the page is reading a stale response."
          />
          <Row
            label="DATABASE_URL"
            value={<ConfiguredBadge on={config?.secrets?.database_url} />}
            hint="Unset means workflows, credentials and memory all 503."
          />
          <Row
            label="CREDENTIALS_ENCRYPTION_KEY"
            value={
              <ConfiguredBadge on={config?.secrets?.credentials_encryption_key} />
            }
            hint="Must byte-match the frontend's, or stored tokens will not decrypt."
          />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Project containers"
          hint="The image a project gets when nothing more specific is detected for its repo."
        />
        <Panel>
          <Row
            label="Default image"
            value={config?.containers?.default_image ?? "—"}
            mono
          />
          <Row
            label="Published port"
            value={config?.containers ? String(config.containers.port) : "—"}
            hint="The container-side port. Docker chooses the host port itself."
          />
        </Panel>
      </section>
    </div>
  );
}

/** Undefined is its own answer: the harness answered without this group. */
function ConfiguredBadge({ on }: { on: boolean | undefined }) {
  if (on === undefined) return <>—</>;
  return (
    <Badge variant={on ? "secondary" : "outline"}>
      {on ? "configured" : "missing"}
    </Badge>
  );
}
