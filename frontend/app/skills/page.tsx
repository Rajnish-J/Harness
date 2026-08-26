import { Sparkles } from "lucide-react";

import RegistryGrid from "@/components/registry/RegistryGrid";
import SectionHeader from "@/components/registry/SectionHeader";
import PageBody from "@/components/shell/PageBody";
import NewSkillButton from "@/components/skills/NewSkillButton";
import { describeDbError } from "@/lib/server/db-error";
import { listSkills } from "@/lib/server/registry-service";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  let skills: Awaited<ReturnType<typeof listSkills>> = [];
  let error: string | null = null;

  try {
    skills = await listSkills();
  } catch (err) {
    error = `Could not load skills: ${describeDbError(err)}`;
  }

  return (
    <PageBody width="wide">
      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Skills"
          hint="A skill is a named bundle of instructions an agent can load on demand, with an optional allowed-tool list."
          action={<NewSkillButton />}
        />
        <RegistryGrid
          error={error}
          href={(id) => `/skills/${id}`}
          icon={Sparkles}
          tone="amber"
          empty={{
            title: "No skills yet",
            description:
              "A skill is a named bundle of instructions an agent can load on demand.",
            action: <NewSkillButton />,
          }}
          rows={skills.map((skill) => ({
            id: skill.id,
            title: skill.name,
            kind: skill.slug,
            meta: skill.description,
            enabled: skill.enabled,
          }))}
        />
      </div>
    </PageBody>
  );
}
