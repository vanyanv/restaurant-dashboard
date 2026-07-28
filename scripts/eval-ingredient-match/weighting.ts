/**
 * Occurrence-weighting (fix-round-3, point 2). `GoldCase.occurrences` counts
 * how many invoice line items collapsed into that one (vendor, name) case —
 * a rare one-off name and a name appearing on 40 invoices are the same "1
 * case" everywhere else in this harness, but money is lost per invoice
 * line, not per distinct product name. Every headline figure gets an
 * occurrence-weighted counterpart alongside the unweighted (per-product) one.
 *
 * No I/O.
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"

export function occurrencesOf(caseIndex: Map<string, GoldCase>, caseId: string): number {
  // Falls back to 1 rather than throwing — every ArmResult.caseId should be
  // in caseIndex (it's built from the same gold set), but a silent 0 would
  // make a case invisible to the weighted totals instead of counting once.
  return caseIndex.get(caseId)?.occurrences ?? 1
}

/** Sum of occurrences across a list of results — the weighted analogue of `.length`. */
export function weightedCount(results: ArmResult[], caseIndex: Map<string, GoldCase>): number {
  return results.reduce((sum, r) => sum + occurrencesOf(caseIndex, r.caseId), 0)
}

export type WeightedPair = { unweighted: number; weighted: number }

/** Both denominators/numerators at once — the common case, so call sites
 * don't have to remember to compute both. */
export function countBoth(results: ArmResult[], caseIndex: Map<string, GoldCase>): WeightedPair {
  return { unweighted: results.length, weighted: weightedCount(results, caseIndex) }
}

/** `n/total` and `weighted-n/weighted-total`, each as a "X (Y%)" string, for
 * a single markdown table cell that shows both readings side by side. */
export function formatBoth(part: ArmResult[], total: ArmResult[], caseIndex: Map<string, GoldCase>): string {
  const p = countBoth(part, caseIndex)
  const t = countBoth(total, caseIndex)
  const uPct = t.unweighted > 0 ? ((p.unweighted / t.unweighted) * 100).toFixed(1) : "0.0"
  const wPct = t.weighted > 0 ? ((p.weighted / t.weighted) * 100).toFixed(1) : "0.0"
  return `${p.unweighted} (${uPct}%) · weighted ${p.weighted} (${wPct}%)`
}
