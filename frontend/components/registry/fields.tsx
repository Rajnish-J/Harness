"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  value,
  onChange,
  rows = 8,
  placeholder,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
          mono ? "font-mono text-xs" : ""
        }`}
      />
    </Field>
  );
}

export function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Multi-select over a fixed set of names, used for tool and attachment pickers. */
export function CheckboxList({
  label,
  hint,
  options,
  selected,
  onChange,
  emptyMessage,
}: {
  label: string;
  hint?: string;
  options: { value: string; label: string; description?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyMessage: string;
}) {
  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  return (
    <Field label={label} hint={hint}>
      {options.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ScrollArea className="max-h-64 rounded-md border">
          <div className="flex flex-col gap-1 p-2">
            {options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="mt-0.5 size-3.5 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>
      )}
    </Field>
  );
}

/** An editable list of strings, used for a stdio server's argv. */
export function StringListField({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-col gap-1.5">
        {values.map((value, index) => (
          <div key={index} className="flex gap-1.5">
            <Input
              value={value}
              placeholder={placeholder}
              className="font-mono text-xs"
              onChange={(e) => {
                const next = [...values];
                next[index] = e.target.value;
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([...values, ""])}
        >
          Add
        </Button>
      </div>
    </Field>
  );
}

/** An editable string map, used for env vars and HTTP headers. */
export function KeyValueField({
  label,
  hint,
  entries,
  onChange,
  valueType = "text",
}: {
  label: string;
  hint?: string;
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  valueType?: string;
}) {
  const rows = Object.entries(entries);

  function replace(next: [string, string][]) {
    onChange(Object.fromEntries(next));
  }

  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-col gap-1.5">
        {rows.map(([key, value], index) => (
          <div key={index} className="flex gap-1.5">
            <Input
              value={key}
              placeholder="KEY"
              className="font-mono text-xs"
              onChange={(e) => {
                const next = [...rows] as [string, string][];
                next[index] = [e.target.value, value];
                replace(next);
              }}
            />
            <Input
              type={valueType}
              value={value}
              placeholder="value"
              className="font-mono text-xs"
              onChange={(e) => {
                const next = [...rows] as [string, string][];
                next[index] = [key, e.target.value];
                replace(next);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => replace(rows.filter((_, i) => i !== index) as [string, string][])}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => replace([...rows, ["", ""]] as [string, string][])}
        >
          Add
        </Button>
      </div>
    </Field>
  );
}
