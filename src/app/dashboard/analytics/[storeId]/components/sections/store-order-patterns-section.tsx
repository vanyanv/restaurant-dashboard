import type { DashboardRange } from "@/lib/dashboard-utils"
import {
  DayOfWeekChartSlot,
  HourlyOrdersChartSlot,
  MonthlyOrdersChartSlot,
} from "../chart-slots"
import { fetchOrderPatterns } from "./data"

export async function StoreOrderPatternsSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const patterns = await fetchOrderPatterns(storeId, range)
  if (!patterns) return null

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <HourlyOrdersChartSlot data={patterns.hourly} />
      <DayOfWeekChartSlot data={patterns.byDayOfWeek} />
      <MonthlyOrdersChartSlot data={patterns.byMonth} />
    </div>
  )
}
