import { getRevenueTrendData } from "@/app/actions/store-actions"
import { OverviewRevenueChart } from "../overview-charts"

/**
 * Seeded server-side at 14 days so the chart paints with the page; the toggle
 * refetches through the same action.
 */
export async function RevenueTrendSection() {
  const trend = await getRevenueTrendData({ days: 14 }).catch(() => null)
  if (!trend || trend.dailyTrends.length === 0) return null
  return <OverviewRevenueChart initial={trend.dailyTrends} />
}
