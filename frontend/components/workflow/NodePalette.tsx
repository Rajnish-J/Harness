"use client";

const ITEMS = [
  {
    type: "agent" as const,
    label: "Agent step",
    hint: "Runs the agent loop with a prompt and a tool subset",
  },
  {
    type: "condition" as const,
    label: "Condition",
    hint: "Routes true/false on a safe predicate over prior outputs",
  },
];

export default function NodePalette() {
  return (
    <div className="flex flex-col gap-2 border-b border-black/[.08] p-3 dark:border-white/[.12]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        Drag onto the canvas
      </p>
      {ITEMS.map((item) => (
        <div
          key={item.type}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/harness-node", item.type);
            event.dataTransfer.effectAllowed = "move";
          }}
          className="cursor-grab rounded-lg border border-black/[.10] px-3 py-2 text-sm transition-colors hover:bg-black/[.03] active:cursor-grabbing dark:border-white/[.14] dark:hover:bg-white/[.05]"
        >
          <div className="font-medium">{item.label}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            {item.hint}
          </div>
        </div>
      ))}
    </div>
  );
}
