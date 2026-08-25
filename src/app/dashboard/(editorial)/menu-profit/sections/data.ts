import { cache } from "react"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"

/**
 * Request-memoized loader so the four streamed sections (KPI strip, matrix,
 * item table, coverage) share ONE getMenuEngineering call instead of running
 * the DailyCogsItem groupBys once each. React `cache` keys on (storeId, days).
 */
export const loadMenuEngineering = cache(
  async (storeId: string | undefined, days: number) =>
    getMenuEngineering({ storeId, lookbackDays: days })
)
