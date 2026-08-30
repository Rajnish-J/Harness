import { notFound } from "next/navigation";

import CredentialEditor from "@/components/credentials/CredentialEditor";
import { getCredential } from "@/lib/server/credential-service";

export const dynamic = "force-dynamic";

// Next 16: params arrive as a Promise.
export default async function CredentialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Already a DTO with ISO dates — credential-service serializes at the row
  // boundary so the ciphertext has no path out of it.
  const credential = await getCredential(id);
  if (!credential) notFound();

  return <CredentialEditor credential={credential} />;
}
