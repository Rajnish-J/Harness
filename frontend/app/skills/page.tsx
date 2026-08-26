import RegistryList from "@/components/registry/RegistryList";
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
    <PageBody toolbar={<NewSkillButton />}>
      <RegistryList
        error={error}
        href={(id) => `/skills/${id}`}
        emptyMessage="No skills yet. A skill is a named bundle of instructions an agent can load on demand."
        rows={skills.map((skill) => ({
          id: skill.id,
          title: skill.name,
          subtitle: skill.description,
          badge: skill.slug,
          enabled: skill.enabled,
        }))}
      />
    </PageBody>
  );
}
