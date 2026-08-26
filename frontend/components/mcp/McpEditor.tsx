"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import UseInChatButton from "@/components/chat/UseInChatButton";
import EditorShell from "@/components/registry/EditorShell";
import {
  Field,
  KeyValueField,
  StringListField,
  TextField,
  ToggleField,
} from "@/components/registry/fields";
import { mcpApi } from "@/lib/registry-api";
import {
  MCP_TRANSPORTS,
  type McpServer,
  type McpTransport,
} from "@/lib/registry-types";

export default function McpEditor({ server }: { server: McpServer }) {
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

      <Field
        label="Transport"
        hint="stdio launches a local process; sse and http dial a remote endpoint."
      >
        <div className="flex gap-2">
          {MCP_TRANSPORTS.map((transport) => (
            <button
              key={transport}
              type="button"
              onClick={() => patch("transport", transport as McpTransport)}
              className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                draft.transport === transport
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {transport}
            </button>
          ))}
        </div>
      </Field>

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
        <KeyValueField
          label="Headers"
          hint="Sent with every request to the endpoint."
          entries={draft.headers}
          onChange={(v) => patch("headers", v)}
        />
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
