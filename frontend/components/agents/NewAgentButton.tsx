"use client";

import NewRecordButton from "@/components/registry/NewRecordButton";
import { agentsApi } from "@/lib/registry-api";

export default function NewAgentButton() {
  return (
    <NewRecordButton
      label="New agent"
      promptText="Name this agent"
      defaultName="Untitled agent"
      hrefFor={(id) => `/agents/${id}`}
      create={(name) => agentsApi.create({ name })}
    />
  );
}
