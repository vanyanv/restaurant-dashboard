import { cache } from "react"
import {
  getOtterAnalytics,
  getMenuCategoryAnalytics,
  getOrderPatterns,
} from "@/app/actions/store-actions"
import {
  rangeToActionOptions,
  type DashboardRange,
} from "@/lib/dashboard-utils"

export const fetchOtter = cache(
  (storeId: string, range: DashboardRange) =>
    getOtterAnalytics(storeId, rangeToActionOptions(range))
)

export const fetchMenuCategory = cache(
  (storeId: string, range: DashboardRange) =>
    getMenuCategoryAnalytics(storeId, rangeToActionOptions(range))
)

export const fetchOrderPatterns = cache(
  (storeId: string, range: DashboardRange) =>
    getOrderPatterns(storeId, rangeToActionOptions(range))
)
