import { cache } from "react"
import {
  getDashboardAnalytics,
  getOtterAnalytics,
  getAllStoresPnL,
} from "@/app/actions/store-actions"
import {
  getInvoiceSummary,
  getInvoiceStoreBreakdown,
  getInvoiceSpendTimeline,
} from "@/app/actions/invoice-actions"
import { resolvePeriod } from "@/app/dashboard/invoices/components/sections/data"
import {
  rangeToActionOptions,
  startOfDayLA,
  endOfDayLA,
  todayInLA,
  type DashboardRange,
} from "@/lib/dashboard-utils"

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

export const fetchInvoiceSpend30d = cache(async () => {
  const p = resolvePeriod("month")
  return getInvoiceSpendTimeline({
    startDate: p.startDate,
    endDate: p.endDate,
    granularity: p.granularity,
  })
})
