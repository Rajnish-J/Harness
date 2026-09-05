"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import UseInChatButton from "@/components/chat/UseInChatButton";
import CredentialPicker from "@/components/projects/CredentialPicker";
import EditorShell from "@/components/registry/EditorShell";
import {
  Field,
  KeyValueField,
  SegmentedField,
  StringListField,
  TextField,
  ToggleField,
} from "@/components/registry/fields";
import type { Credential } from "@/lib/credential-types";
import { mcpApi } from "@/lib/registry-api";
import { MCP_TRANSPORTS, type McpServer } from "@/lib/registry-types";

export default function McpEditor({
  server,
  credentials = [],
}: {
  server: McpServer;
  credentials?: Credential[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(server);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(server),
    [draft, server],
  );

  function patch<K extends keyof McpServer>(key: K, value: McpServer[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const isStdio = draft.transport === "stdio";

  return (
    <EditorShell
      title={server.name}
      backHref="/mcp"
      dirty={dirty}
      actions={<UseInChatButton kind="mcp" value={server.name} />}
      deleteLabel={`Delete the MCP server "${server.name}"? This cannot be undone.`}
      onSave={async () => {
        await mcpApi.update(server.id, {
          name: draft.name,
          description: draft.description,
          transport: draft.transport,
          command: draft.command,
          args: draft.args,
          url: draft.url,
          env: draft.env,
          headers: draft.headers,
          credentialId: draft.credentialId,
          enabled: draft.enabled,
        });
      }}
      onDelete={async () => {
        await mcpApi.remove(server.id);
        router.push("/mcp");
      }}
    >
      <TextField
        label="Name"
        value={draft.name}
        onChange={(v) => patch("name", v)}
      />

      <TextField
        label="Description"
        value={draft.description ?? ""}
        placeholder="What this server provides"
        onChange={(v) => patch("description", v || null)}
      />

      <SegmentedField
        label="Transport"
        hint="stdio launches a local process; sse and http dial a remote endpoint."
        options={MCP_TRANSPORTS.map((transport) => ({
          value: transport,
          label: transport,
        }))}
        value={draft.transport}
        onChange={(v) => patch("transport", v)}
      />

      {isStdio ? (
        <>
          <TextField
            label="Command"
            hint="The executable to launch, e.g. npx or uvx."
            value={draft.command ?? ""}
            placeholder="npx"
            onChange={(v) => patch("command", v || null)}
          />
          <StringListField
            label="Arguments"
            hint="One argv entry per row — not a shell string, so no quoting rules apply."
            values={draft.args}
            placeholder="-y"
            onChange={(v) => patch("args", v)}
          />
        </>
      ) : (
        <TextField
          label="URL"
          value={draft.url ?? ""}
          placeholder="https://example.com/mcp"
          onChange={(v) => patch("url", v || null)}
        />
      )}

      <KeyValueField
        label="Environment"
        hint="Passed to the server process. Stored in plaintext — this is a local harness."
        entries={draft.env}
        valueType="password"
        onChange={(v) => patch("env", v)}
      />

      {!isStdio && (
        <>
          <div className="flex flex-col gap-1.5">
            <CredentialPicker
              credentials={credentials}
              value={draft.credentialId}
              onChange={(v) => patch("credentialId", v)}
              label="Credential"
              allowNone
            />
            <p className="text-[11px] text-muted-foreground">
              Sent as an Authorization bearer token, decrypted at connect time.
              Preferred over typing a token into Headers below, which stores it
              in plaintext.
            </p>
          </div>

          <KeyValueField
            label="Headers"
            hint="Sent with every request to the endpoint. A linked credential above overrides an Authorization header set here."
            entries={draft.headers}
            onChange={(v) => patch("headers", v)}
          />
        </>
      )}

      <ToggleField
        label="Enabled"
        hint="Disabled servers stay configured but are not connected."
        checked={draft.enabled}
        onChange={(v) => patch("enabled", v)}
      />

      <Field label="Connection preview" hint="What the harness will run or dial.">
        <p className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
          {isStdio
            ? [draft.command, ...draft.args].filter(Boolean).join(" ") ||
              "— no command set"
            : draft.url || "— no url set"}
        </p>
      </Field>
    </EditorShell>
  );
}
