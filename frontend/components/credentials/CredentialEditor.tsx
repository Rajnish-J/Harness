"use client";

import { PlugZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import EditorShell from "@/components/registry/EditorShell";
import {
  Field,
  SegmentedField,
  TextField,
  ToggleField,
} from "@/components/registry/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { credentialsApi } from "@/lib/credential-api";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_LABELS,
  maskToken,
  type Credential,
  type CredentialProvider,
} from "@/lib/credential-types";

/**
 * The token field is the whole reason this is not a stock registry editor.
 *
 * Every other editor in the app round-trips its record: load it, change it, save
 * it. A secret cannot do that, because nothing on the server will hand it back.
 * So `secret` is not part of `draft` — it is separate state that starts empty and
 * means "replace the token" when non-empty. Leaving it blank keeps the stored
 * one, which is why the placeholder shows the masked tail rather than dots that
 * might be mistaken for an editable value.
 */
export default function CredentialEditor({
  credential,
}: {
  credential: Credential;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(credential);
  const [secret, setSecret] = useState("");
  const [testing, setTesting] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(credential) || secret.trim() !== "",
    [draft, credential, secret],
  );

  function patch<K extends keyof Credential>(key: K, value: Credential[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function test() {
    setTesting(true);
    try {
      const result = await credentialsApi.test(credential.id);
      // The verdict is stored server-side, and a successful test backfills the
      // username, so pull the fresh row rather than guessing at it here.
      router.refresh();
      if (result.ok) {
        toast.success({ title: "Connection verified", description: result.message });
      } else {
        toast.error({ title: "Connection failed", description: result.message });
      }
    } catch (err) {
      toast.error({ title: "Connection failed", description: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const validated = credential.lastValidatedAt
    ? new Date(credential.lastValidatedAt).toLocaleString()
    : null;

  return (
    <EditorShell
      title={credential.name}
      backHref="/credentials"
      dirty={dirty}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={test}
          disabled={testing}
        >
          <PlugZap />
          {testing ? "Testing…" : "Test connection"}
        </Button>
      }
      deleteLabel={`Delete the credential "${credential.name}"? Projects using it will keep working until they next need to sync.`}
      onSave={async () => {
        await credentialsApi.update(credential.id, {
          name: draft.name,
          provider: draft.provider,
          username: draft.username,
          enabled: draft.enabled,
          // Only sent when the operator typed a replacement. Omitting the key
          // entirely is what tells the server to keep the stored token.
          ...(secret.trim() ? { secret: secret.trim() } : {}),
        });
        setSecret("");
      }}
      onDelete={async () => {
        await credentialsApi.remove(credential.id);
        router.push("/credentials");
      }}
    >
      <TextField label="Name" value={draft.name} onChange={(v) => patch("name", v)} />

      <SegmentedField
        label="Provider"
        hint="Decides which API the token is tested and used against."
        options={CREDENTIAL_PROVIDERS.map((value) => ({
          value,
          label: PROVIDER_LABELS[value],
        }))}
        value={draft.provider}
        onChange={(v) => patch("provider", v as CredentialProvider)}
      />

      <TextField
        label="Username"
        hint="Filled in automatically by a successful connection test."
        value={draft.username ?? ""}
        placeholder="octocat"
        onChange={(v) => patch("username", v || null)}
      />

      <Field
        label="Token"
        hint="Leave blank to keep the current token. Anything you type replaces it."
      >
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          placeholder={`${maskToken(credential.lastFour)} — stored, encrypted`}
          className="font-mono text-xs"
          onChange={(event) => setSecret(event.target.value)}
        />
      </Field>

      <Field label="Status">
        <div className="flex flex-col gap-1 rounded-md border px-3 py-2 text-xs">
          {credential.lastValidationError ? (
            <span className="text-red-700 dark:text-red-300">
              Last test failed: {credential.lastValidationError}
            </span>
          ) : validated ? (
            <span className="text-emerald-700 dark:text-emerald-300">
              Verified {validated}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Not tested yet — press Test connection.
            </span>
          )}
          {credential.scopes.length > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">
              scopes: {credential.scopes.join(", ")}
            </span>
          )}
        </div>
      </Field>

      <ToggleField
        label="Enabled"
        hint="Disabled credentials stay stored but are not offered when adding a project."
        checked={draft.enabled}
        onChange={(v) => patch("enabled", v)}
      />
    </EditorShell>
  );
}
