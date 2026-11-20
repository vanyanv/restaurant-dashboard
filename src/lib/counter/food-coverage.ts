/**
 * Whether a food-cost figure is a reading, and how much of it is whole.
 *
 * The one rule every page that prints a food % or a prime cost asks, so the
 * P&L, the Overview and Analytics cannot disagree about it (2026-11-20 audit):
 *
 * 1. **Known.** With sales on the books and no COGS posted — the materializer
 *    has not run, or the range reaches days it has not reached — `cogsValue`
 *    is 0 and the rollup's `cogsPct` is a confident 0.0%. That is an absence,
 *    not a reading: no food % and no prime cost are printed off it.
 * 2. **Partial.** A known food cost can still be short: store-days that sold
 *    with no recipe-cost rows (`cogsMissingDays`) and sales on items with no
 *    recipe or unpriced ingredients (`uncostedSales`) both count as $0 food.
 *    The figure stays, labelled, in the same plain words the P&L's plain page
 *    prints beside its food line (`pnl-plain.ts` reads its words from here).
 */

/** The three fields the rule reads. `StatementLines` and `StoreStatement` both satisfy it. */
export interface FoodCoverageInput {
  grossSales: number
  cogsValue: number
  /** Store-days that sold with no recipe-cost rows. Absent on old cached rollups: read as 0. */
  cogsMissingDays?: number
  /** Sales on items whose food cost is not fully counted. Absent on old cached rollups: read as 0. */
  uncostedSales?: number
}

/** The words a food cell prints when nothing at all is posted. */
export const NO_FOOD_COST = "no food cost posted"

/** Whether food cost is a reading on this range: sales to divide by, and food posted against them. */
export function foodKnown(l: Pick<FoodCoverageInput, "grossSales" | "cogsValue">): boolean {
  return l.grossSales > 0 && l.cogsValue > 0
}

/** Share of sales whose food cost is not fully counted, or null with no sales. */
export function uncostedShare(l: Pick<FoodCoverageInput, "grossSales" | "uncostedSales">): number | null {
  return l.grossSales > 0 ? Math.min(1, Math.max(0, l.uncostedSales ?? 0) / l.grossSales) : null
}

/** "12%", or "under 1%" for a share that rounds to nothing but is not nothing. */
export function pctWords(v: number): string {
  const r = Math.round(v * 100)
  return r === 0 && v > 0 ? "under 1%" : `${r}%`
}

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`
}

/**
 * Why a food figure is partial, in words, most serious first. Empty when the
 * food cost is whole. `["3 days with no food cost", "12% of sales not fully costed"]`.
 */
export function foodGapParts(l: FoodCoverageInput): string[] {
  const out: string[] = []
  const missing = l.cogsMissingDays ?? 0
  if (missing > 0) out.push(`${days(missing)} with no food cost`)
  const u = uncostedShare(l)
  if (u !== null && u > 0) out.push(`${pctWords(u)} of sales not fully costed`)
  return out
}

/** The partial label as one line, or null when the food cost is whole. */
export function foodGapNote(l: FoodCoverageInput): string | null {
  const parts = foodGapParts(l)
  return parts.length > 0 ? `partial · ${parts.join(" · ")}` : null
}

/**
 * A cell's caption with the partial label appended — `"Plan 28.0% · partial ·
 * 3 days with no food cost"` — or the caption unchanged when the food cost is
 * whole. `undefined` stays `undefined` so a cell grows no empty band.
 */
export function withFoodGap(caption: string | undefined, l: FoodCoverageInput): string | undefined {
  const note = foodGapNote(l)
  if (note === null) return caption
  return caption ? `${caption} · ${note}` : note
}
