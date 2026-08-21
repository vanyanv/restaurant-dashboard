/**
 * Short store labels for tight chrome — scope tabs, stamps, folios.
 *
 * Every store in an account is named "<Brand> - <Location>", so a tab strip
 * rendered from raw names reads "CHRIS N EDDYS - GLENDALE | CHRIS N EDDYS -
 * VAN NUYS | CHRIS N EDDYS - HOLLYWOOD" and the brand — the one word that is
 * identical on every tab and therefore carries no information — eats most of
 * the width. Strip it, but only when it really is shared.
 */

const SEPARATORS = [" — ", " – ", " - "]

function splitOnce(name: string): { prefix: string; rest: string } | null {
  for (const sep of SEPARATORS) {
    const i = name.indexOf(sep)
    if (i > 0) {
      return { prefix: name.slice(0, i).trim(), rest: name.slice(i + sep.length).trim() }
    }
  }
  return null
}

/**
 * Returns a label per input name, brand prefix removed when every name shares
 * one. A single store, or names that disagree, are returned untouched — losing
 * the only identifying word would be worse than a long tab.
 */
export function shortStoreLabels(names: string[]): string[] {
  if (names.length === 0) return []

  const split = names.map(splitOnce)
  if (split.some((s) => s === null || s.rest.length === 0)) return names

  const prefixes = new Set(split.map((s) => s!.prefix.toLowerCase()))
  if (prefixes.size !== 1) return names

  return split.map((s) => s!.rest)
}
