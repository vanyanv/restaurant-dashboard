import { cache } from "react"
import {
  getDashboardAnalytics,
  getOtterAnalytics,
} from "@/app/actions/store-actions"
import {
  getInvoiceSummary,
  getInvoiceStoreBreakdown,
  getInvoiceSpendTimeline,
} from "@/app/actions/invoice-actions"
import { resolvePeriod } from "@/app/dashboard/invoices/components/sections/data"
import {
  rangeToActionOptions,
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
