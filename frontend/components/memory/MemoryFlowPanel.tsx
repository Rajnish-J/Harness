import { ArrowDown, Database, FileText, PenLine, Sparkles } from "lucide-react";

/**
 * How a memory gets from one conversation into every other one.
 *
 * Four labelled steps rather than an illustration: the mechanism is a
 * sequence, and a const array rendered as bordered rows (the shape
 * components/workflow/NodePalette.tsx uses for its legend) stays legible in
 * both themes and needs no SVG to maintain.
 *
 * The copy names the real functions on purpose. Someone reading this page is
 * usually about to go read the code, and a step that says `_prepare_turn`
 * tells them where to start.
 */

const STEPS = [
  {
    icon: PenLine,
    label: "Write",
    title: "The agent calls remember() — or you add one by hand",
    detail:
      "Mid-turn, when it learns something durable: a preference, a correction, a fact about the project. The tool records which session it happened in. On /memory you can write one yourself.",
    where: "backend/app/agent/tools/memory_tools.py",
  },
  {
    icon: Database,
    label: "Store",
    title: "One row, in one of two scopes",
    detail:
      "A row with no project is global and reaches every conversation. A project-scoped row reaches only that project's. Re-using a slug edits the existing memory instead of piling up a duplicate.",
    where: "memory_entries",
  },
  {
    icon: Sparkles,
    label: "Compose",
    title: "Every turn re-reads memory and builds a <memories> block",
    detail:
      "Not cached per session: the read happens on each request, so an edit or a new memory takes effect on the very next turn. Memories are sorted by (kind, slug) so the prompt prefix stays byte-stable and cacheable.",
    where: "_prepare_turn → compose_system_prompt",
  },
  {
    icon: FileText,
    label: "Read",
    title: "Any session in scope sees it — including ones already open",
    detail:
      "This is the whole point: a fact learned in one conversation lands in another conversation's next turn, with nothing typed into it and no restart.",
    where: "the model's system prompt",
  },
] as const;

export default function MemoryFlowPanel() {
  return (
    <section className="rounded-xl border bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        How memory reaches the agent
      </p>

      <ol className="mt-3 flex flex-col gap-1">
        {STEPS.map((step, index) => (
          <li key={step.label}>
            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <step.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {index + 1}. {step.label}
                </span>
                <span className="text-sm font-medium">{step.title}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {step.detail}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                {step.where}
              </p>
            </div>
            {index < STEPS.length - 1 && (
              <div className="flex justify-center py-0.5" aria-hidden>
                <ArrowDown className="size-3 text-muted-foreground/50" />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
