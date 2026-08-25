import type { DashboardRange } from "@/lib/dashboard-utils"
import { MenuCategoryTableSlot, TopItemsChartSlot } from "../chart-slots"
import { fetchMenuCategory } from "./data"

export async function StoreMenuSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const menu = await fetchMenuCategory(storeId, range)
  if (!menu) return null

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TopItemsChartSlot data={menu} />
      <MenuCategoryTableSlot data={menu} />
    </div>
  )
}
