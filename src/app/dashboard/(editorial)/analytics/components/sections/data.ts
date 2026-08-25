import { cache } from "react"
import {
  getDashboardAnalytics,
  getOtterAnalytics,
  getMenuCategoryAnalytics,
} from "@/app/actions/store-actions"
import {
  rangeToActionOptions,
  type DashboardRange,
} from "@/lib/dashboard-utils"

export const fetchDashboard = cache((range: DashboardRange) =>
  getDashboardAnalytics(rangeToActionOptions(range))
)

export const fetchOtter = cache((range: DashboardRange) =>
  getOtterAnalytics(undefined, rangeToActionOptions(range))
)

export const fetchMenuCategory = cache((range: DashboardRange) =>
  getMenuCategoryAnalytics(undefined, rangeToActionOptions(range))
)
