import { NextResponse } from "next/server";

import {
  MODEL_PROVIDERS,
  type ModelProvider,
} from "@/lib/model-credential-types";
import { CredentialCryptoError } from "@/lib/server/crypto";
import {
  createModelCredential,
  listModelCredentials,
} from "@/lib/server/model-credential-service";
import { reportDbError } from "@/lib/server/db-error";
import {
  BadRequest,
  badRequest,
  isUniqueViolation,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  readJsonBody,
  requiredString,
} from "@/lib/server/request";

// `pg` needs the Node runtime. Do not set runtime = "edge" here.

function readProvider(body: Record<string, unknown>): ModelProvider {
  const value = body.provider;
  if (
    typeof value !== "string" ||
    !MODEL_PROVIDERS.includes(value as ModelProvider)
  ) {
    throw new BadRequest(`provider must be one of: ${MODEL_PROVIDERS.join(", ")}`);
  }
  return value as ModelProvider;
}

export async function GET() {
  try {
    return NextResponse.json(await listModelCredentials());
  } catch (error) {
    return NextResponse.json(
      { error: reportDbError("GET /api/model-credentials", error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let input;
  try {
    const body = await readJsonBody(request);
    input = {
      provider: readProvider(body),
      label: optionalString(body, "label"),
      // Required on create: a credential with no key is not a credential.
      secret: requiredString(body, "secret"),
      baseUrl: optionalString(body, "baseUrl"),
      extraModels: optionalStringArray(body, "extraModels"),
      enabled: optionalBoolean(body, "enabled"),
    };
  } catch (error) {
    if (error instanceof BadRequest) return badRequest(error.message);
    throw error;
  }

  try {
    return NextResponse.json(await createModelCredential(input), { status: 201 });
  } catch (error) {
    // A misconfigured key is an operator problem with a specific fix, so it gets
    // its own status and its own message rather than a generic 500.
    if (error instanceof CredentialCryptoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    // The unique constraint is on `provider`, so this is always the same
    // collision and the message can name the fix precisely.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          error:
            `A key for ${input.provider} is already registered. ` +
            "Edit that one to replace it — there is one key per provider.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: reportDbError("POST /api/model-credentials", error) },
      { status: 500 },
    );
  }
}
