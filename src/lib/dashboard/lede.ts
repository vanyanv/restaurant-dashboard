/**
 * The masthead lede — one sentence that answers "is today good or bad" before
 * any figure, plus an optional suggestion.
 *
 * Rules, not a model call. Every clause is derived from a number already on the
 * page, and a clause is dropped rather than softened when its input is missing:
 * a machine-written headline that overreaches is worse than no headline, because
 * it is the most prominent text on the product and the owner will believe it.
 *
 * Session-free and I/O-free.
 */

export interface LedeInput {
  /** Net-sales pace vs the weekday-aligned four-week baseline, in percent. */
  salesPacePct: number | null
  /** Order-count pace on the same baseline, in percent. */
  ordersPacePct: number | null
  /** "Thu", "Sun–Tue", "30 days" — whatever the range actually spans. */
  weekdayLabel: string
  /** True when the last day of the range is today and an hour cutoff applied. */
  inProgress: boolean
  /** Today's labor as a share of sales, 0–1. Null when it has not settled. */
  laborPct: number | null
  /** Same share averaged over the baseline weeks, 0–1. */
  baselineLaborPct: number | null
  /** Today's sales, used to price the labor gap in dollars. */
  totalSales: number | null
  /**
   * Margin as a share of sales, 0–1, or null when it has not settled. The
   * labor clause is not allowed to claim the margin is holding without it: on
   * a day running at −4.0% the lede read "labor came down with them, so the
   * margin is holding" directly above a net profit of −$53.
   */
  marginPct: number | null
}

export interface Lede {
  headline: string
  suggestion: string | null
  /** The provenance line under the lede. */
  source: string
}

/** Below this the difference is noise and the sentence should not name it. */
const MATERIAL_PCT = 2
/** Labor gap worth mentioning, in percentage points of sales. */
const MATERIAL_LABOR_PTS = 0.5

function pct(n: number): string {
  return `${Math.abs(Math.round(n * 10) / 10)}%`
}

function money(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`
}

/** "a normal Thursday" reads better than "a normal Thu" in a display sentence. */
const WEEKDAY_LONG: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
}

function comparisonPhrase(label: string): string {
  const long = WEEKDAY_LONG[label]
  return long ? `a normal ${long}` : `the same ${label} a month back`
}

export function buildLede(input: LedeInput): Lede | null {
  const {
    salesPacePct,
    ordersPacePct,
    weekdayLabel,
    inProgress,
    laborPct,
    baselineLaborPct,
    totalSales,
    marginPct,
  } = input

  // No baseline, no verdict. `formatPaceLine` already withholds the pace below
  // two usable weeks, so a null here means the comparison was not trustworthy.
  if (salesPacePct == null) return null

  const against = comparisonPhrase(weekdayLabel)
  const flat = Math.abs(salesPacePct) < MATERIAL_PCT

  const first = flat
    ? `Sales are running level with ${against}.`
    : `Sales are tracking ${pct(salesPacePct)} ${
        salesPacePct < 0 ? "behind" : "ahead of"
      } ${against}.`

  // Second clause: separate traffic from ticket, which is the one thing the
  // rail's four figures cannot say on their own.
  let second = ""
  if (ordersPacePct != null && !flat) {
    const sameDirection = Math.sign(ordersPacePct) === Math.sign(salesPacePct)
    if (sameDirection && Math.abs(ordersPacePct) >= MATERIAL_PCT) {
      second = ` Orders moved with them, ${pct(ordersPacePct)} ${
        ordersPacePct < 0 ? "down" : "up"
      }.`
    } else if (!sameDirection && Math.abs(ordersPacePct) >= MATERIAL_PCT) {
      second = ` Orders went the other way, ${pct(ordersPacePct)} ${
        ordersPacePct < 0 ? "down" : "up"
      }, so the ticket is carrying it.`
    }
  }

  // Third clause and the suggestion both need labor against its own baseline.
  const laborGapPts =
    laborPct != null && baselineLaborPct != null
      ? (laborPct - baselineLaborPct) * 100
      : null

  let third = ""
  let suggestion: string | null = null

  if (laborGapPts != null && laborGapPts >= MATERIAL_LABOR_PTS) {
    third =
      salesPacePct < -MATERIAL_PCT
        ? " Labor has not come down with them, so the shortfall is landing on profit."
        : " Labor is running above its usual share of sales."

    if (totalSales != null && totalSales > 0) {
      const dollars = (laborGapPts / 100) * totalSales
      suggestion = `Labor is ${
        Math.round(laborGapPts * 10) / 10
      } points above its four-week share. Closing that gap is worth about ${money(
        dollars
      )} on today's profit.`
    }
  } else if (laborGapPts != null && laborGapPts <= -MATERIAL_LABOR_PTS) {
    // Only claim the margin when there is a positive margin to claim.
    third =
      marginPct != null && marginPct > 0
        ? " Labor came down with them, so the margin is holding."
        : marginPct != null
          ? " Labor came down with them, but the day is still under water."
          : " Labor came down with them."
  }

  const source = [
    `Read against the last four ${weekdayLabel === "Thu" || WEEKDAY_LONG[weekdayLabel] ? `${weekdayLabel}s` : "comparable ranges"}`,
    inProgress ? "same hours" : "full days",
  ].join(" · ")

  return { headline: `${first}${second}${third}`, suggestion, source }
}
