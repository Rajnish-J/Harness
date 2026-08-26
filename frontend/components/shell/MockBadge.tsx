import { FlaskConical } from "lucide-react";

import { anyMock, flags, mockedSurfaces } from "@/lib/flags";

/**
 * Visible marker that some surface is serving fixtures.
 *
 * Not decoration: without it, a stale NEXT_PUBLIC_MOCK_ALL=true reads as a
 * backend bug, and you can lose an afternoon to debugging data that was never
 * going to come from Postgres.
 */
export default function MockBadge() {
  if (!anyMock) return null;

  const surfaces = mockedSurfaces();
  const label = flags.mockAll ? "All mock" : `Mock: ${surfaces.join(", ")}`;

  return (
    <span
      title={`Serving fixture data for: ${surfaces.join(", ")}. Set the NEXT_PUBLIC_MOCK_* flags in .env and restart next dev to change this.`}
      className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
    >
      <FlaskConical className="size-3" />
      {label}
    </span>
  );
}
