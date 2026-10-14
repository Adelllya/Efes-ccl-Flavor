/**
 * English singular/plural by count: 1 drink, 2 drinks.
 * Signature keeps three forms for older callers: `one`, `few` (plural), optional `many` (plural, wins if given).
 */
export function plural(n: number, one: string, few: string, many?: string): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return one;
  return many ?? few;
}

/** Count with its word: "51 pairings", "1 pairing". */
export function countOf(n: number, one: string, few: string, many?: string): string {
  return `${n} ${plural(n, one, few, many)}`;
}
