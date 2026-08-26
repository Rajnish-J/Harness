import { notFound } from "next/navigation";

import SkillEditor from "@/components/skills/SkillEditor";
import type { Skill } from "@/lib/registry-types";
import { getSkill } from "@/lib/server/registry-service";

export const dynamic = "force-dynamic";

// Next 16: params arrive as a Promise.
export default async function SkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getSkill(id);
  if (!row) notFound();

  const skill: Skill = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return <SkillEditor skill={skill} />;
}
