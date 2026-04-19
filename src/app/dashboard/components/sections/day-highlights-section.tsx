import { DayHighlights } from "@/components/analytics/day-highlights"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { SectionHead } from "../section-head"
import { fetchOtter } from "./data"

export async function DayHighlightsSection({
  range,
}: {
  range: DashboardRange
}) {
  const otter = await fetchOtter(range)
  if (!otter || otter.dailyTrends.length <= 1) return null

  return (
    <div className="dock-in dock-in-3">
      <SectionHead label="Notable days" />
      <DayHighlights dailyTrends={otter.dailyTrends} />
    </div>
  )
}
