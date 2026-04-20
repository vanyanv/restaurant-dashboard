import { cache } from "react"
import {
  getDashboardAnalytics,
  getOtterAnalytics,
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
