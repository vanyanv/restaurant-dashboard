import { COMPARISONS, type ComparisonId } from "@/lib/counter/date-range"
import { delta, deltaSign } from "@/lib/counter/format"
import type { Statement } from "@/lib/counter/statement"
import type { DeltaTone } from "@/components/counter"

/**
 * "Against what", once — for every Counter page that prints a change.
 *
 * Extracted from `adapters/overview.ts`, unchanged, at the point the P&L
 * became the second page to print "▲ 4.1% vs the prior period". Two pages
 * comparing the same range to the same window and writing the difference two
 * ways is note 60 in the comparison column: not a formula difference in any
 * one figure, but the same arithmetic given two different denominators, two
 * flat thresholds, or two tones.
 *
 * Three decisions live here and nowhere else:
 *
 * - **The divisor.** `comparisonRange(r, "weekday")` returns a window
 *   CONTAINING four occurrences of the range's weekdays, not an equivalent
 *   period. Its MONEY has to be divided by four before it can be read against
 *   one period; its PERCENTAGES do not, because a ratio over four days is
 *   already a ratio. Getting that backwards prints a quarter of a percentage.
 * - **The absence of a comparison is a reading too.** "no comparison set" is
 *   `is-flat`, never unclassed — `.headline .d` and `.mhead .d` paint
 *   `var(--good)` by default, so an unclassed absence is good news about
 *   nothing.
 * - **The tone is a judgement about the FIGURE, not a reading of the arrow.**
 *   Net sales down is bad; marketplace fees down is a win. A component that
 *   inferred tone from the ▼ could not express the second, so the caller that
 *   knows what the figure means picks it. `comparisonPhrase` is written for
 *   the figures whose direction and sentiment agree, which is what both pages'
 *   head figures are.
 */

export interface ComparisonContext {
  /** The comparison's own rollup, when one was asked for and it loaded. */
  scope: Statement | null
  /** "the prior period" — reads inside a sentence. */
  label: string
  /** "vs prior" — reads inside a chart tooltip. */
  short: string
  /** How many equivalent periods the comparison window holds. See the module note. */
  divisor: number
  on: boolean
}

export function comparisonContext(
  mode: ComparisonId,
  scope: Statement | null,
): ComparisonContext {
  const c = COMPARISONS.find((x) => x.id === mode) ?? COMPARISONS[COMPARISONS.length - 1]
  return {
    scope,
    label: c.label.replace(/^vs /, ""),
    short: c.short.replace(/^vs /, ""),
    divisor: mode === "weekday" ? 4 : 1,
    on: mode !== "none" && scope !== null,
  }
}

/** A head figure's change, and how it should read. */
export interface ComparisonReading {
  text: string
  /** The `.d` class. Undefined reads as a rise. */
  tone?: DeltaTone
}

/**
 * "▲ 4.1% vs the prior period", or the honest absence of one.
 *
 * `base` is the comparison window's figure BEFORE the divisor — this applies
 * it, so no caller can forget to.
 */
export function comparisonPhrase(
  now: number,
  cmp: ComparisonContext,
  base: number | null,
): ComparisonReading {
  if (!cmp.on || base === null) return { text: "no comparison set", tone: "is-flat" }
  const previous = base / cmp.divisor
  if (previous === 0) return { text: `no ${cmp.label} to compare`, tone: "is-flat" }
  const change = (now - previous) / previous
  const sign = deltaSign(change)
  return {
    text: `${delta(change)} vs ${cmp.label}`,
    // Up is the default and needs no class — see `DeltaTone`.
    tone: sign === 1 ? undefined : sign === -1 ? "is-down" : "is-flat",
  }
}
