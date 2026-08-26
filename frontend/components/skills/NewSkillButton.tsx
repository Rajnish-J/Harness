"use client";

import NewRecordButton from "@/components/registry/NewRecordButton";
import { skillsApi } from "@/lib/registry-api";

export default function NewSkillButton() {
  return (
    <NewRecordButton
      label="New skill"
      promptText="Name this skill"
      defaultName="Untitled skill"
      hrefFor={(id) => `/skills/${id}`}
      create={(name) => skillsApi.create({ name })}
    />
  );
}
