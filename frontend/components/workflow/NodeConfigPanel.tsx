"use client";

import { useEffect, useState } from "react";

import type { FlowNode } from "@/lib/graph-serde";
import { fetchTools, type ToolInfo } from "@/lib/workflow-api";
import type {
  AgentNodeConfig,
  ComparisonOp,
  ConditionNodeConfig,
  UnaryOp,
} from "@/lib/workflow-types";

const BINARY_OPS: ComparisonOp[] = [
  "eq", "ne", "lt", "lte", "gt", "gte",
  "contains", "not_contains", "starts_with", "ends_with", "in", "not_in",
];
const UNARY_OPS: UnaryOp[] = ["is_empty", "is_not_empty", "is_true", "is_false"];

const label = "text-[11px] font-medium uppercase tracking-wide text-zinc-400";
const field =
  "w-full rounded-lg border border-black/[.10] bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-white/[.14]";

export default function NodeConfigPanel({
  node,
  otherNodeIds,
  onChange,
  onDelete,
}: {
  node: FlowNode | null;
  otherNodeIds: string[];
  onChange: (nodeId: string, patch: { label?: string; config?: unknown }) => void;
  onDelete: (nodeId: string) => void;
}) {
  const [tools, setTools] = useState<ToolInfo[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTools(controller.signal).then(setTools);
    return () => controller.abort();
  }, []);

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-400">
        Select a node to configure it.
      </div>
    );
  }

  const isAgent = node.data.nodeType === "agent";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <label className={label}>Label</label>
        <input
          className={`${field} mt-1`}
          value={node.data.label}
          onChange={(e) => onChange(node.id, { label: e.target.value })}
        />
        <p className="mt-1 font-mono text-[10px] text-zinc-400">id: {node.id}</p>
      </div>

      {isAgent ? (
        <AgentConfig
          config={node.data.config as AgentNodeConfig}
          tools={tools}
          otherNodeIds={otherNodeIds}
          onChange={(config) => onChange(node.id, { config })}
        />
      ) : (
        <ConditionConfig
          config={node.data.config as ConditionNodeConfig}
          otherNodeIds={otherNodeIds}
          onChange={(config) => onChange(node.id, { config })}
        />
      )}

      <button
        type="button"
        onClick={() => onDelete(node.id)}
        className="mt-auto rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/5 dark:text-red-400"
      >
        Delete node
      </button>
    </div>
  );
}

function AgentConfig({
  config,
  tools,
  otherNodeIds,
  onChange,
}: {
  config: AgentNodeConfig;
  tools: ToolInfo[];
  otherNodeIds: string[];
  onChange: (config: AgentNodeConfig) => void;
}) {
  const selected = config.tools;
  const allTools = selected === null || selected === undefined || selected.length === 0;

  return (
    <>
      <div>
        <label className={label}>Prompt</label>
        <textarea
          rows={7}
          className={`${field} mt-1 resize-y font-mono text-xs`}
          value={config.prompt ?? ""}
          placeholder="What should this step do?"
          onChange={(e) => onChange({ ...config, prompt: e.target.value })}
        />
        {otherNodeIds.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-zinc-400">insert:</span>
            <RefChip
              text="{{ input }}"
              onClick={() =>
                onChange({ ...config, prompt: `${config.prompt ?? ""}{{ input }}` })
              }
            />
            {otherNodeIds.map((id) => (
              <RefChip
                key={id}
                text={`{{ ${id}.output }}`}
                onClick={() =>
                  onChange({
                    ...config,
                    prompt: `${config.prompt ?? ""}{{ ${id}.output }}`,
                  })
                }
              />
            ))}
          </div>
        )}
        <p className="mt-1 text-[10px] leading-snug text-zinc-400">
          A reference only works if that node is guaranteed to finish first —
          parallel siblings are rejected on save.
        </p>
      </div>

      <div>
        <label className={label}>Tools</label>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allTools}
            onChange={(e) =>
              onChange({ ...config, tools: e.target.checked ? null : [] })
            }
          />
          All tools
        </label>
        {!allTools && (
          <div className="mt-1 flex flex-col gap-1">
            {tools.map((tool) => (
              <label key={tool.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected?.includes(tool.name) ?? false}
                  onChange={(e) => {
                    const next = new Set(selected ?? []);
                    if (e.target.checked) next.add(tool.name);
                    else next.delete(tool.name);
                    onChange({ ...config, tools: [...next] });
                  }}
                />
                <span className="font-mono text-xs">{tool.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>Max iterations</label>
          <input
            type="number"
            min={1}
            max={50}
            className={`${field} mt-1`}
            value={config.max_iterations ?? ""}
            placeholder="default"
            onChange={(e) =>
              onChange({
                ...config,
                max_iterations: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
        <div>
          <label className={label}>On error</label>
          <select
            className={`${field} mt-1`}
            value={config.on_error ?? "fail"}
            onChange={(e) =>
              onChange({ ...config, on_error: e.target.value as "fail" | "continue" })
            }
          >
            <option value="fail">Stop the run</option>
            <option value="continue">Continue</option>
          </select>
        </div>
      </div>
    </>
  );
}

function RefChip({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 transition-colors hover:bg-black/[.10] dark:bg-white/10 dark:hover:bg-white/20"
    >
      {text}
    </button>
  );
}

/**
 * Structured predicate builder.
 *
 * There is deliberately no free-text expression field here. A text box that
 * gets parsed is exactly how eval() gets reintroduced into a rule engine; the
 * backend only accepts tagged operands and an allowlisted operator, so the UI
 * only offers those.
 */
function ConditionConfig({
  config,
  otherNodeIds,
  onChange,
}: {
  config: ConditionNodeConfig;
  otherNodeIds: string[];
  onChange: (config: ConditionNodeConfig) => void;
}) {
  const predicate = (config?.predicate ?? {}) as Record<string, unknown>;
  const op = (predicate.op as string) ?? "eq";
  const isUnary = UNARY_OPS.includes(op as UnaryOp);
  const leftPath =
    (predicate.left as { path?: string } | undefined)?.path ?? "";
  const rightValue = (predicate.right as { value?: unknown } | undefined)?.value;

  const paths = otherNodeIds.flatMap((id) => [
    `outputs.${id}.status`,
    `outputs.${id}.text`,
  ]);

  function update(next: Record<string, unknown>) {
    onChange({ predicate: next as ConditionNodeConfig["predicate"] });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={label}>Compare</label>
        <select
          className={`${field} mt-1 font-mono text-xs`}
          value={leftPath}
          onChange={(e) =>
            update({ ...predicate, left: { path: e.target.value } })
          }
        >
          <option value="">select a value…</option>
          {paths.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Operator</label>
        <select
          className={`${field} mt-1 font-mono text-xs`}
          value={op}
          onChange={(e) => {
            const nextOp = e.target.value;
            const next: Record<string, unknown> = {
              left: predicate.left ?? { path: leftPath },
              op: nextOp,
            };
            // Unary operators must not carry a right operand — the backend
            // rejects the predicate outright if they do.
            if (!UNARY_OPS.includes(nextOp as UnaryOp)) {
              next.right = predicate.right ?? { value: "" };
            }
            update(next);
          }}
        >
          <optgroup label="Compare to a value">
            {BINARY_OPS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </optgroup>
          <optgroup label="No value needed">
            {UNARY_OPS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {!isUnary && (
        <div>
          <label className={label}>Value</label>
          <input
            className={`${field} mt-1 font-mono text-xs`}
            value={typeof rightValue === "string" ? rightValue : String(rightValue ?? "")}
            placeholder="ok"
            onChange={(e) =>
              update({ ...predicate, right: { value: e.target.value } })
            }
          />
          <p className="mt-1 text-[10px] text-zinc-400">
            Treated as a literal, never as a path or an expression.
          </p>
        </div>
      )}
    </div>
  );
}
