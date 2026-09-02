/**
 * The reader's own name for a storm the radar is tracking.
 *
 * The algorithm decides which blobs across three volumes are one storm and
 * labels it something like A1, which means nothing to a person. Somebody
 * watching a supercell for two hours calls it something, and carrying that
 * word across the loop is a very small change with a disproportionate hold on
 * the person doing the watching.
 *
 * The rules that keep it honest:
 *
 * - A name follows the identity the algorithm gives, not a position. When the
 *   algorithm stops tracking that storm the name goes with it, rather than
 *   landing on whichever cell inherits the identifier next.
 * - The algorithm's own identifier stays visible beside the name. The name is
 *   the reader's; the identity is the data's, and a screenshot of this has to
 *   be checkable against the office's own products.
 * - Names are local and bounded. A handful of them, short, held for the
 *   session, and written down nowhere unless the reader deliberately puts one
 *   in their record.
 */

/** How many storms can carry a name at once. */
export const MAX_NAMES = 12;

/** How long one may be. Long enough for "the one over the lake". */
export const MAX_NAME = 24;

/** A name for one cell of one radar's report. */
export function cellKey(station: string, id: string): string {
  return `${station}|${id}`;
}

function tidy(name: string): string {
  // A label on a map, so no line breaks and nothing else that is a control
  // character. Written as an escape rather than as the characters themselves,
  // which is how a literal newline ended up inside this class the first time.
  return name
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

/**
 * The names after one has been set, cleared, or refused.
 *
 * An empty name removes it, which is how a name is taken back. Past the limit
 * the oldest goes, because a reader who has named a thirteenth storm meant to
 * name it.
 */
export function withName(
  names: ReadonlyMap<string, string>,
  key: string,
  name: string,
): Map<string, string> {
  const next = new Map(names);
  const kept = tidy(name);
  next.delete(key);
  if (!kept) return next;
  next.set(key, kept);
  while (next.size > MAX_NAMES) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

/**
 * The names for storms the algorithm is still tracking.
 *
 * Anything else is dropped. Identifiers are reused: a storm the radar stopped
 * seeing an hour ago frees its label, and a name left behind would reappear
 * on a different storm entirely, which is worse than losing the name.
 */
export function livingNames(
  names: ReadonlyMap<string, string>,
  station: string | null,
  tracking: readonly string[],
): Map<string, string> {
  const alive = new Set(tracking.map((id) => cellKey(station ?? "", id)));
  const next = new Map<string, string>();
  for (const [key, name] of names) {
    if (alive.has(key)) next.set(key, name);
  }
  return next;
}
