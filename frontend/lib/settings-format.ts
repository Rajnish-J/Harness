/**
 * Byte counts and durations, for the read-only limits the settings page shows.
 *
 * Siblings of formatContext/formatPrice in ./models.ts, kept out of that file
 * because they have nothing to do with the model catalog.
 */

/**
 * Decimal units, not binary: these numbers come from `.env` where someone typed
 * `MAX_FILE_BYTES=200000`, and echoing that back as "195.3 KiB" would make the
 * page harder to reconcile with the file it came from, not easier.
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${round(bytes / 1_000)} kB`;
  return `${round(bytes / 1_000_000)} MB`;
}

/**
 * Minutes only past two of them, for the same reason formatBytes uses decimal
 * units: MCP_TOOL_TIMEOUT=60.0 should read back as "60s", not as "1m" that has
 * to be converted before it can be compared to the file it came from. The idle
 * timeout at 300s is where minutes genuinely help.
 */
export function formatSeconds(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 120) return `${round(seconds)}s`;
  return `${round(seconds / 60)}m`;
}

/** Thousands separators, because six-digit char budgets are the common case. */
export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

/**
 * A char budget with its unit. Separate from formatCount because the unit has
 * to disappear along with the number — "— chars" reads as a value of zero.
 */
export function formatChars(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${formatCount(value)} chars`;
}

/** One decimal place, but only when it says something: 30s not 30.0s. */
function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
