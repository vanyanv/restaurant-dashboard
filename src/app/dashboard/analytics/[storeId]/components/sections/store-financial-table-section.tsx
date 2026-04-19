import { FinancialTable } from "@/components/analytics/financial-table"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchOtter } from "./data"

export async function StoreFinancialTableSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  if (!analytics) return null
  return <FinancialTable data={analytics.platformBreakdown} />
}
