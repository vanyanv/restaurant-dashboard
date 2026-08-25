import { DashboardSection } from "@/components/analytics/dashboard-section"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { TopItemsChartSlot } from "../chart-slots"
import { fetchMenuCategory } from "./data"

export async function TopMenuItemsSection({
  range,
}: {
  range: DashboardRange
}) {
  const menu = await fetchMenuCategory(range)
  if (!menu) return null

  return (
    <DashboardSection title="Top Menu Items">
      <TopItemsChartSlot data={menu} />
    </DashboardSection>
  )
}
