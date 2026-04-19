import { HourlyOrdersDashboardCard } from "@/components/analytics/hourly-orders-dashboard-card"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchDashboard } from "./data"

export async function HourlyOrdersSection({
  range,
}: {
  range: DashboardRange
}) {
  const data = await fetchDashboard(range)
  const stores =
    data?.rows
      .filter((r) => r.storeId !== "total")
      .map((r) => ({ id: r.storeId, name: r.storeName })) ?? []

  return <HourlyOrdersDashboardCard stores={stores} />
}
