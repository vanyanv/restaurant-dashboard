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
  rangeToActionOptions,
  type DashboardRange,
} from "@/lib/dashboard-utils"

export const fetchOtter = cache((range: DashboardRange) =>
  getOtterAnalytics(undefined, rangeToActionOptions(range))
)

export const fetchDashboard = cache((range: DashboardRange) =>
  getDashboardAnalytics(rangeToActionOptions(range))
)

export const fetchInvoiceSummary = cache(() =>
  getInvoiceSummary({ days: 30 })
)

export const fetchInvoiceBreakdown = cache(() =>
  getInvoiceStoreBreakdown({ days: 30 })
)

/** Resolve a DashboardRange into concrete start/end Date objects. */
function rangeToDates(range: DashboardRange): { startDate: Date; endDate: Date } {
  const endDate = new Date()
  endDate.setHours(23, 59, 59, 999)
  if (range.kind === "days") {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - (range.days - 1))
    startDate.setHours(0, 0, 0, 0)
    return { startDate, endDate }
  }
  // kind === "custom"
  return {
    startDate: new Date(range.startDate + "T00:00:00.000Z"),
    endDate: new Date(range.endDate + "T23:59:59.999Z"),
  }
}

export const fetchAllStoresPnL = cache((range: DashboardRange) => {
  const { startDate, endDate } = rangeToDates(range)
  return getAllStoresPnL({ startDate, endDate, granularity: "daily" })
})
