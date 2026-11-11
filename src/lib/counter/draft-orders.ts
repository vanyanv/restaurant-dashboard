import { computeReorderRecommendation, type ReorderStatus } from "@/lib/inventory/reorder-recommendation"

/**
 * Draft orders: the one function that says how much of an item to order.
 *
 * Everything here is an ESTIMATE and the page says so. It is built only from
 * numbers already on file, each of which the page names next to the line:
 *
 *   - on hand now: the last count, plus deliveries on invoices since, minus
 *     what sales used through recipes, minus logged waste
 *     (`runningOnHandFromContext`, the same figure the count report checks);
 *   - expected use per day: the store's own forecast of menu items, through
 *     recipes, for the next 14 days, or, with no forecast, the last 14 days of
 *     sales through recipes;
 *   - lead time: the vendor's measured median days from invoices;
 *   - case size: `recipeUnitsPerCase` on the ingredient, the same one that
 *     turns invoice cases into on-hand.
 *
 * The order covers the days until it arrives (lead time), the days it should
 * last after that (the owner's "cover" choice on the page), and the safety
 * buffer `computeReorderRecommendation` already uses everywhere, max(1, half
 * the lead time). What is on hand now is taken off, and the rest is rounded UP
 * to whole cases, because you cannot order 0.3 of a case.
 */

/** How many days an order should last after it arrives. Chosen on the page. */
export const COVER_DAY_CHOICES = [3, 7, 14] as const
export const DEFAULT_COVER_DAYS = 7

export function parseCoverDays(raw: string | undefined | null): number {
  const n = Number(raw)
  return (COVER_DAY_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_COVER_DAYS
}

/**
 * Expected use over `days` (may be fractional) from today: the daily series
 * first, then `tailRate` per day past its end. A half day counts half of that
 * day's use.
 */
export function demandOver(series: number[], tailRate: number, days: number): number {
  if (!(days > 0)) return 0
  let total = 0
  let left = days
  for (let i = 0; i < series.length && left > 0; i++) {
    const take = Math.min(1, left)
    total += Math.max(0, series[i]) * take
    left -= take
  }
  if (left > 0) total += Math.max(0, tailRate) * left
  return total
}

export interface DraftInput {
  /** Recipe units on the shelf now. */
  onHand: number
  /** Expected use per day from today, in recipe units. */
  series: number[]
  /** Expected use per day past the end of `series`. */
  tailRate: number
  leadDays: number
  coverDays: number
  /** Recipe units in one case. Null when nobody has set the case size. */
  recipeUnitsPerCase: number | null
  asOf: Date
}

export interface DraftLine {
  status: ReorderStatus
  /** The day to place it by. Null when nothing can be read. */
  orderBy: Date | null
  safetyDays: number
  /** leadDays + coverDays + safetyDays. */
  windowDays: number
  /** Expected use over the window, in recipe units. */
  need: number
  /** need − onHand. Zero or below means the shelf already covers it. */
  short: number
  /** Whole cases to order; null when the case size is unknown. */
  cases: number | null
  /** What that order brings in, in recipe units. */
  orderQty: number
  /** Expected use per day today, for the "about N a day" line. */
  perDay: number
}

export function draftLine(input: DraftInput): DraftLine {
  const { onHand, series, tailRate, leadDays, coverDays, recipeUnitsPerCase, asOf } = input
  const perDay = series.length > 0 ? series.reduce((t, v) => t + Math.max(0, v), 0) / series.length : Math.max(0, tailRate)
  const reco = computeReorderRecommendation({ onHand, ratePerDay: perDay, leadDays, asOf })
  const safetyDays = reco.safetyDays
  const windowDays = leadDays + coverDays + safetyDays
  const need = demandOver(series, tailRate, windowDays)
  const short = need - onHand
  let cases: number | null = null
  let orderQty = 0
  if (short > 0) {
    if (recipeUnitsPerCase != null && recipeUnitsPerCase > 0) {
      // A hair of float noise (2.0000000001 cases) must not order a third case.
      cases = Math.ceil(short / recipeUnitsPerCase - 1e-9)
      orderQty = cases * recipeUnitsPerCase
    } else {
      orderQty = Math.ceil(short - 1e-9)
    }
  }
  return {
    status: reco.status,
    orderBy: reco.reorderBy,
    safetyDays,
    windowDays,
    need,
    short,
    cases,
    orderQty,
    perDay,
  }
}
