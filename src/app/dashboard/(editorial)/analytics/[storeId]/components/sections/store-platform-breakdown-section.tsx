import type { DashboardRange } from "@/lib/dashboard-utils"
import {
  PaymentSplitChartSlot,
  PlatformBreakdownChartSlot,
} from "../chart-slots"
import { fetchOtter } from "./data"

export async function StorePlatformBreakdownSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  if (!analytics) return null

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PlatformBreakdownChartSlot data={analytics.platformBreakdown} />
      <PaymentSplitChartSlot data={analytics.paymentSplit} />
    </div>
  )
}
