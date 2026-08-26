"use client";

import type { ValidationIssue } from "@/lib/workflow-types";

export default function ValidationBanner({
  issues,
  onFocus,
}: {
  issues: ValidationIssue[];
  onFocus: (nodeId: string) => void;
}) {
  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div
      className={`border-b px-4 py-2 text-xs ${
        errors.length
          ? "border-red-500/30 bg-red-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <p className="mb-1 font-medium">
        {errors.length
          ? `${errors.length} problem${errors.length > 1 ? "s" : ""} to fix before this can run`
          : `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}
      </p>
      <ul className="flex flex-col gap-0.5">
        {[...errors, ...warnings].map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="flex items-start gap-1.5">
            <span
              className={
                issue.severity === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }
            >
              •
            </span>
            <span className="text-foreground">
              {issue.message}
              {issue.node_id && (
                <button
                  type="button"
                  onClick={() => onFocus(issue.node_id!)}
                  className="ml-1.5 font-mono text-[10px] text-muted-foreground underline hover:text-foreground"
                >
                  {issue.node_id}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
