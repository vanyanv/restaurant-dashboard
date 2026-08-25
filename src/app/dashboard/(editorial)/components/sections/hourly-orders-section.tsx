import { HourlyOrdersDashboardCard } from "@/components/analytics/hourly-orders-dashboard-card"
import type { DashboardPromise } from "./data"

export async function HourlyOrdersSection({
  dashboardPromise,
}: {
  dashboardPromise: DashboardPromise
}) {
  const data = await dashboardPromise
  const stores =
    data?.rows
      .filter((r) => r.storeId !== "total")
      .map((r) => ({ id: r.storeId, name: r.storeName })) ?? []

  return <HourlyOrdersDashboardCard stores={stores} />
}
