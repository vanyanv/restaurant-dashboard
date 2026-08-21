// Profit-and-margin twin of the sales pace line in `hourly-orders.ts`.
//
// The hero strip compares the selected range against the same dates shifted
// back one to four weeks. Profit and margin had no such comparison at all —
// "$1,204 · 18.4% margin" told an owner nothing about whether that was a good
// day. This computes the same weekday-aligned baseline from a daily-granularity
// P&L, so both halves of Overview answer "compared to what?" the same way.

import {
  AFTER_LABOR_RENT_CODE,
  LABOR_CODE,
  TOTAL_SALES_CODE,
  type PnLRow,
} from "@/lib/pnl"

export interface PnLTotals {
  totalSales: number
  bottomLine: number
  /**
   * Labor dollars over the same days. Always set by `sumPnLDays`; optional on
   * the interface so the hand-built totals that `computePnLPace` accepts (which
   * never look at labor) do not all have to carry a field they ignore.
   */
  labor?: number
}

export interface PnLPace {
  /** Percent change in net profit vs the baseline average. */
  profitPct: number | null
  /** Margin change in percentage points (not percent-of-percent). */
  marginDeltaPts: number | null
  /** How many of the four shifted weeks had sales to compare against. */
  baselineWeeks: number
}

/** Sum the daily P&L rows falling on `dates`. `periodDates[i]` names `values[i]`. */
export function sumPnLDays(
  rows: PnLRow[],
  periodDates: string[],
  dates: Iterable<string>
): PnLTotals {
  const wanted = new Set(dates)
  const salesRow = rows.find((r) => r.code === TOTAL_SALES_CODE)
  const profitRow = rows.find((r) => r.code === AFTER_LABOR_RENT_CODE)
  const laborRow = rows.find((r) => r.code === LABOR_CODE)

  let totalSales = 0
  let bottomLine = 0
  let labor = 0
  periodDates.forEach((date, i) => {
    if (!wanted.has(date)) return
    totalSales += salesRow?.values[i] ?? 0
    bottomLine += profitRow?.values[i] ?? 0
    labor += laborRow?.values[i] ?? 0
  })
  // Costs are stored as negatives in the P&L rows, so labor sums to a negative
  // number while `combined.laborPct` is a positive share. Comparing the two
  // directly produced a "labor is 40.6 points above its four-week share" lede
  // on a business running 22.4% labor. A share of sales is a magnitude; take it
  // as one, whichever sign convention the row uses.
  return { totalSales, bottomLine, labor: Math.abs(labor) }
}

/**
 * Compare the current window against the average of the baseline groups.
 *
 * Groups with no sales are dropped rather than averaged in as zeros — a week
 * the restaurant was closed (or that predates the data) would otherwise drag
 * the baseline down and manufacture a gain. Returns null below two usable
 * weeks, matching `formatPaceLine`: one week is an anecdote, not a baseline.
 */
export function computePnLPace(
  current: PnLTotals,
  baselineGroups: PnLTotals[]
): PnLPace | null {
  const usable = baselineGroups.filter((g) => g.totalSales > 0)
  if (usable.length < 2) return null

  const baseSales = usable.reduce((a, g) => a + g.totalSales, 0) / usable.length
  const baseProfit = usable.reduce((a, g) => a + g.bottomLine, 0) / usable.length

  // A baseline that lost money makes "% better than" meaningless — a swing from
  // −$100 to +$100 is not "+200%". Withhold the percentage; the margin
  // point-delta below still reads correctly through a sign change.
  const profitPct =
    baseProfit > 0
      ? Math.round(((current.bottomLine - baseProfit) / baseProfit) * 1000) / 10
      : null

  const marginDeltaPts =
    current.totalSales > 0 && baseSales > 0
      ? Math.round(
          (current.bottomLine / current.totalSales - baseProfit / baseSales) *
            1000
        ) / 10
      : null

  return { profitPct, marginDeltaPts, baselineWeeks: usable.length }
}

/** "▲ 12% vs avg Tue" / "▼ 4% vs avg Tue–Mon". */
export function formatProfitPace(
  pace: PnLPace | null,
  label: string
): string | null {
  if (!pace || pace.profitPct == null) return null
  const pct = pace.profitPct
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "·"
  return `${arrow} ${Math.abs(pct).toFixed(0)}% vs avg ${label}`
}

/** "+2.1 pts vs avg Tue" — margin is a rate, so it moves in points. */
export function formatMarginPace(
  pace: PnLPace | null,
  label: string
): string | null {
  if (!pace || pace.marginDeltaPts == null) return null
  const pts = pace.marginDeltaPts
  const sign = pts > 0 ? "+" : pts < 0 ? "−" : "±"
  return `${sign}${Math.abs(pts).toFixed(1)} pts vs avg ${label}`
}
