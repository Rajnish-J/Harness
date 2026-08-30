/**
 * Coarse relative time — "3 days ago", not "3 days 4 hours ago".
 *
 * `Intl.RelativeTimeFormat` rather than a date library: every list view in the
 * app wants the same one-phrase answer to "when was this last touched", and
 * that is one function against a built-in.
 */

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

export function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return RELATIVE.format(-Math.round(elapsed / ms), unit);
    }
  }
  return "just now";
}
