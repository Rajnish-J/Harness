/**
 * Small helpers shared by the registry route handlers.
 *
 * They exist so six near-identical handlers don't each re-implement "parse the
 * body, reject non-objects, coerce a string array".
 */

import { NextResponse } from "next/server";

export class BadRequest extends Error {}

/** Parse a JSON object body, or throw BadRequest. */
export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new BadRequest("Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequest("Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Postgres 23505 is a unique-constraint violation. Every registry table has a
 * unique name or slug, so this is a routine user error (409), not a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current = error as { code?: string; cause?: unknown };
  while (current) {
    if (current.code === "23505") return true;
    if (!(current.cause instanceof Error)) return false;
    current = current.cause as { code?: string; cause?: unknown };
  }
  return false;
}

export function requiredString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequest(`${field} is required`);
  }
  return value.trim();
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new BadRequest(`${field} must be a string`);
  return value;
}

export function optionalText(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (typeof value !== "string") throw new BadRequest(`${field} must be a string`);
  return value;
}

export function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new BadRequest(`${field} must be an array of strings`);
  }
  return value as string[];
}

export function optionalStringMap(
  body: Record<string, unknown>,
  field: string,
): Record<string, string> | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequest(`${field} must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, v]) => typeof v !== "string")) {
    throw new BadRequest(`${field} values must be strings`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
): boolean | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (typeof value !== "boolean") throw new BadRequest(`${field} must be a boolean`);
  return value;
}

export function optionalPositiveInt(
  body: Record<string, unknown>,
  field: string,
): number | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new BadRequest(`${field} must be a positive integer`);
  }
  return value;
}
