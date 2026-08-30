import { NextResponse } from "next/server";

import { CREDENTIAL_PROVIDERS, type CredentialProvider } from "@/lib/credential-types";
import { CredentialCryptoError } from "@/lib/server/crypto";
import { createCredential, listCredentials } from "@/lib/server/credential-service";
import { reportDbError } from "@/lib/server/db-error";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

function readProvider(body: Record<string, unknown>): CredentialProvider | undefined {
  if (!("provider" in body)) return undefined;
  const value = body.provider;
  if (typeof value !== "string" || !CREDENTIAL_PROVIDERS.includes(value as CredentialProvider)) {
    throw new BadRequest(`provider must be one of: ${CREDENTIAL_PROVIDERS.join(", ")}`);
  }
  return value as CredentialProvider;
}

export async function GET() {
  try {
    return NextResponse.json(await listCredentials());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/credentials", error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let input;
  try {
    const body = await readJsonBody(request);
    input = {
      name: requiredString(body, "name"),
      provider: readProvider(body),
      username: optionalString(body, "username"),
      // Required on create: a credential with no token is not a credential.
      secret: requiredString(body, "secret"),
      enabled: optionalBoolean(body, "enabled"),
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    return NextResponse.json(await createCredential(input), { status: 201 });
  } catch (error) {
    // A misconfigured key is an operator problem with a specific fix, so it gets
    // its own status and its own message rather than a generic 500.
    if (error instanceof CredentialCryptoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `A credential named "${input.name}" already exists.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/credentials", error) },
      { status: 500 },
    );
  }
}
