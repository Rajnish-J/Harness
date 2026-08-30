"use client";

import { Label } from "@/components/ui/label";
import type { Credential } from "@/lib/credential-types";

/**
 * Pick one stored credential, as a row of buttons.
 *
 * Extracted from GithubRepoPicker so the Edit dialog and the repo picker offer
 * the same control — a project's linked credential is the same choice in both
 * places, and two chooser layouts for it would be a bug waiting to happen.
 *
 * Buttons rather than a <select>, matching SegmentedField in
 * components/registry/fields.tsx: a harness typically holds one or two tokens,
 * and hiding that behind a click makes an obvious choice feel like a setting.
 */
export default function CredentialPicker({
  credentials,
  value,
  onChange,
  disabled = false,
  label = "Credential",
  /** Offer "None" — a project can legitimately have no credential linked. */
  allowNone = false,
}: {
  credentials: Credential[];
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  label?: string;
  allowNone?: boolean;
}) {
  const usable = credentials.filter((credential) => credential.enabled);

  if (usable.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No enabled credentials. Add a GitHub token on the Credentials page first.
      </div>
    );
  }

  const options: { id: string | null; name: string }[] = allowNone
    ? [{ id: null, name: "None" }, ...usable]
    : usable;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id ?? "__none__"}
            type="button"
            disabled={disabled}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
              value === option.id
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent"
            }`}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
