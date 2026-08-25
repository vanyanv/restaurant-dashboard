import { cache } from "react"
import {
  getDashboardAnalytics,
  getOtterAnalytics,
  getAllStoresPnL,
} from "@/app/actions/store-actions"
import {
  getInvoiceSummary,
  getInvoiceStoreBreakdown,
} from "@/app/actions/invoice-actions"
import {
  addDaysLA,
  rangeToActionOptions,
  startOfDayLA,
  endOfDayLA,
  todayInLA,
  type DashboardRange,
} from "@/lib/dashboard-utils"
import { deriveRangeSpec, laDateMinusDays } from "@/lib/hourly-orders"

/**
 * Fires every server-action the dashboard shell needs in one place and hands
 * each section the same in-flight promise. Each section still suspends on
 * its own promise so the page streams progressively, but the underlying
 * server action is invoked exactly once per render.
 *
 * The previous shape (cache()-wrapped helpers called from each section)
 * deduped within a single RSC render pass but missed across Suspense
 * boundaries, so the dashboard root was firing 6 RSC fetches per nav.
 */
export function buildDashboardData(range: DashboardRange) {
  const opts = rangeToActionOptions(range)
  return {
    dashboard: getDashboardAnalytics(opts),
    otter: getOtterAnalytics(undefined, opts),
  }
}

export type DashboardPromise = ReturnType<
  typeof buildDashboardData
>["dashboard"]
export type OtterPromise = ReturnType<typeof buildDashboardData>["otter"]

/**
 * Fires the all-stores P&L action for the dashboard's selected range so the
 * owner-only Profitability section can surface profit/COGS/labor/margin at a
 * glance. Mirrors the same range the rest of Overview uses (gross/net already
 * reflect it). `getAllStoresPnL` enforces owner access server-side, but the
 * shell still gates the render so non-owners never trigger the fetch.
 */
export function buildPnLSummary(range: DashboardRange) {
  // Resolve the range exactly the way getDashboardAnalytics/getOtterAnalytics do
  // (see dashboard-analytics-actions.ts) so the P&L window lines up with the
  // hero figures: days=1 → today, days=-1 → yesterday only, days=N → last N+1
  // days ending today. Diverging here is what made "Yesterday" show today's
  // partial data.
  let startDate: Date
  let endDate: Date

  if (range.kind === "custom") {
    startDate = startOfDayLA(range.startDate)
    endDate = endOfDayLA(range.endDate)
  } else {
    const today = todayInLA()
    endDate = endOfDayLA(today)
    const days = range.days
    if (days === 1) {
      startDate = startOfDayLA(today)
    } else if (days === -1) {
      const yday = startOfDayLA(today)
      yday.setDate(yday.getDate() - 1)
      startDate = yday
      endDate = new Date(yday.getTime() + 24 * 60 * 60 * 1000 - 1)
    } else {
      const start = startOfDayLA(today)
      start.setDate(start.getDate() - days)
      startDate = start
    }
  }

  return getAllStoresPnL({ startDate, endDate, granularity: "daily" })
}

export type PnLSummaryPromise = ReturnType<typeof buildPnLSummary>

export const fetchInvoiceSummary = cache(() =>
  getInvoiceSummary({ days: 30 })
)

export const fetchInvoiceBreakdown = cache(() =>
  getInvoiceStoreBreakdown({ days: 30 })
)


/**
 * Longest range that still gets a profit pace line.
 *
 * The baseline needs a daily-granularity P&L spanning the range plus three
 * weeks, and `getAllStoresPnL` recomputes every store for every day in that
 * window. At a month that is ~52 daily periods — fine, and cached for ten
 * minutes. At ninety days it is a quarter of P&L arithmetic to decorate one
 * line of type, so past this the section simply shows no comparison.
 */
export const MAX_PNL_PACE_DAYS = 31

export interface PnLBaseline {
  /** Daily P&L covering every baseline date — one call, not four. */
  promise: ReturnType<typeof getAllStoresPnL>
  /** Ascending LA dates, index-aligned with that result's daily `periods`. */
  periodDates: string[]
  /** The selected dates shifted back 1–4 weeks, one group per week. */
  comparisonGroups: string[][]
  /** How the range names itself in "vs avg ___" — shared with the hero strip. */
  label: string
  /** True when the range ends today, i.e. costs have not finished posting. */
  inProgress: boolean
}

/**
 * Baseline P&L for the profit/margin pace on Overview.
 *
 * Pulls one daily-granularity P&L across the whole 4-week-back window and lets
 * the section pick out the same weekdays, rather than firing four separate
 * range calls. Returns null when the range is too long to be worth the query
 * (see MAX_PNL_PACE_DAYS) or when there is nothing to compare.
 */
export function buildPnLBaseline(range: DashboardRange): PnLBaseline | null {
  const spec = deriveRangeSpec(range)
  const dates = spec.currentDates
  if (dates.length === 0 || dates.length > MAX_PNL_PACE_DAYS) return null

  const earliest = laDateMinusDays(dates[0], 28)
  const latest = laDateMinusDays(dates[dates.length - 1], 7)

  const periodDates: string[] = []
  for (let d = earliest; d <= latest; d = addDaysLA(d, 1)) periodDates.push(d)

  return {
    promise: getAllStoresPnL({
      startDate: startOfDayLA(earliest),
      endDate: endOfDayLA(latest),
      granularity: "daily",
    }),
    periodDates,
    comparisonGroups: spec.comparisonGroups,
    label: spec.weekdayLabel,
    inProgress: spec.hourCutoff != null,
  }
}
