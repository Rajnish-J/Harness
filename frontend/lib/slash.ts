/**
 * Slash-command token detection for the composer.
 *
 * Pure and caret-based so the menu's open state can be *derived during render*
 * rather than stored. Storing it would mean a setState inside an effect, which
 * this repo's lint rules reject — and which would also lag one keystroke behind.
 */

export type SlashToken = {
  /** Text after the slash, up to the caret. */
  query: string;
  /** Index of the "/" itself. */
  start: number;
  /** Index just past the caret, i.e. the end of the token. */
  end: number;
};

/**
 * The token being typed at `caret`, or null.
 *
 * The slash must start a word: at position 0, or immediately after whitespace.
 * That single rule is what stops `https://example.com` and `src/lib/api.ts`
 * from opening the menu mid-sentence, which is the failure that makes naive
 * slash menus unusable.
 */
export function slashTokenAt(value: string, caret: number): SlashToken | null {
  if (caret < 0 || caret > value.length) return null;

  let index = caret - 1;
  while (index >= 0) {
    const char = value[index];
    if (char === "/") break;
    // Whitespace before finding a slash means we are not inside a token.
    if (/\s/.test(char)) return null;
    index -= 1;
  }

  if (index < 0) return null;

  const before = index === 0 ? "" : value[index - 1];
  if (before !== "" && !/\s/.test(before)) return null;

  return { query: value.slice(index + 1, caret), start: index, end: caret };
}

export type SlashOption = {
  kind: "agent" | "skill";
  id: string;
  label: string;
  hint?: string | null;
  /** Matched against the query. */
  terms: string[];
};

/**
 * Rank prefix matches above substring matches, then alphabetically.
 *
 * With an empty query the caller's order is preserved, which is `updatedAt
 * desc` from the registries — most recently touched first is the right default.
 */
export function filterSlashOptions(
  options: SlashOption[],
  query: string,
  limitPerKind = 6,
): SlashOption[] {
  const needle = query.trim().toLowerCase();

  const scored = options
    .map((option) => {
      if (!needle) return { option, score: 0 };
      const terms = option.terms.map((t) => t.toLowerCase());
      if (terms.some((t) => t.startsWith(needle))) return { option, score: 0 };
      if (terms.some((t) => t.includes(needle))) return { option, score: 1 };
      return { option, score: -1 };
    })
    .filter((entry) => entry.score >= 0);

  if (needle) {
    scored.sort(
      (a, b) => a.score - b.score || a.option.label.localeCompare(b.option.label),
    );
  }

  const counts = { agent: 0, skill: 0 };
  const out: SlashOption[] = [];
  // Agents first: picking one cascades its skills and tools, so it is the more
  // consequential choice and belongs at the top.
  for (const kind of ["agent", "skill"] as const) {
    for (const { option } of scored) {
      if (option.kind !== kind) continue;
      if (counts[kind] >= limitPerKind) break;
      counts[kind] += 1;
      out.push(option);
    }
  }
  return out;
}

/** Replace the token with `replacement`, returning the new value and caret. */
export function replaceToken(
  value: string,
  token: SlashToken,
  replacement: string,
): { value: string; caret: number } {
  const next = value.slice(0, token.start) + replacement + value.slice(token.end);
  return { value: next, caret: token.start + replacement.length };
}
