import { UNCONVERTED_UNIT } from "@/lib/inventory/anchor-line"

/**
 * "Went missing", between two finished counts: the headline figure, what it
 * covers, and which rows count as a match. The Report tab, the Inventory
 * overview's tile, the by-store comparison and the one-item page all read
 * these, so a row that "matches" on one of them matches on the others and the
 * headline is one number.
 *
 * Client-safe: no Prisma, only arithmetic.
 */

export type GapFigureRow = {
  /** should − counted, in dollars. Null when the item has no price on file. */
  missingDollars: number | null
}

export type GapHeadline = {
  /** Items counted both times: what the figure covers. */
  items: number
  /** Compared items with no price on file: not in `missingDollars`. */
  unpriced: number
  /**
   * Σ of the SHORTAGES on the compared items that have a price. Null when
   * none could be valued (nothing counted both times, or no prices): an
   * unknown, never $0. A real $0 is "compared, priced, nothing short".
   */
  missingDollars: number | null
}

export function gapHeadline(rows: ReadonlyArray<GapFigureRow>): GapHeadline {
  const unpriced = rows.filter((r) => r.missingDollars === null).length
  return {
    items: rows.length,
    unpriced,
    missingDollars: unpriced < rows.length ? rows.reduce((t, r) => t + Math.max(0, r.missingDollars ?? 0), 0) : null,
  }
}

export type GapAmounts = { should: number; counted: number; missing: number }

/** Within 5% of the bigger of the two amounts: the count agrees with the numbers. */
export function gapMatches(r: GapAmounts): boolean {
  return Math.abs(r.missing) < Math.max(0.05 * Math.max(r.should, r.counted), 0.01)
}

export type GapVerdict = "match" | "short" | "extra"

export function gapVerdict(r: GapAmounts): GapVerdict {
  return gapMatches(r) ? "match" : r.missing > 0 ? "short" : "extra"
}

/**
 * The two bars of one row on one scale: "should have" and "counted" as shares
 * of the bigger. A "should have" below zero (more used than was there) draws
 * as an empty bar; the words beside it carry the number.
 */
export function gapBars(r: Pick<GapAmounts, "should" | "counted">): { should: number; counted: number } {
  const max = Math.max(r.should, r.counted, 0)
  if (max <= 0) return { should: 0, counted: 0 }
  return { should: Math.max(0, r.should) / max, counted: Math.max(0, r.counted) / max }
}

export type GapCoverage = {
  /** Lines on the count list. */
  lines: number
  /** Lines whose item is on a row: counted this time and the time before. */
  compared: number
  /** On this count with a box that has no size, so the line is only part of the shelf. */
  noSize: number
  /** Not on this count at all. */
  notOnThis: number
  /** On this count, with no whole line on the count before to start from. */
  notOnLast: number
}

/**
 * "N of M lines compared", and why the rest were not. A line is one stop of
 * the count list; an item counted at two stops is two lines and one row.
 * First reason that applies wins, so the four numbers add up to `lines`.
 */
export function gapCoverage(input: {
  /** The count list: the item of each line. */
  lineItems: ReadonlyArray<string>
  /** Every line saved on the later count. */
  countLines: ReadonlyArray<{ canonicalIngredientId: string; nativeUnit: string | null }>
  /** The items that have a row. */
  compared: ReadonlyArray<string>
}): GapCoverage {
  const on = new Map(input.countLines.map((l) => [l.canonicalIngredientId, l.nativeUnit === UNCONVERTED_UNIT]))
  const compared = new Set(input.compared)
  const out: GapCoverage = { lines: input.lineItems.length, compared: 0, noSize: 0, notOnThis: 0, notOnLast: 0 }
  for (const id of input.lineItems) {
    if (compared.has(id)) out.compared++
    else if (!on.has(id)) out.notOnThis++
    else if (on.get(id)) out.noSize++
    else out.notOnLast++
  }
  return out
}
